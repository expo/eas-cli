import { SystemError } from '@expo/eas-build-job';
import { graphql } from 'gql.tada';
import fetch, { Headers } from 'node-fetch';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { CustomBuildContext } from '../../customBuildContext';
import { withDeviceRunSessionTimeoutAsync } from './deviceRunSessionTimeout';

const CREATE_DEVICE_RUN_SESSION_ARTIFACT_UPLOAD_SESSION_MUTATION = graphql(`
  mutation CreateDeviceRunSessionArtifactUploadSession(
    $deviceRunSessionId: ID!
    $input: CreateDeviceRunSessionArtifactUploadSessionInput!
  ) {
    deviceRunSession {
      createArtifactUploadSession(deviceRunSessionId: $deviceRunSessionId, input: $input) {
        uploadSession {
          url
          headers
        }
      }
    }
  }
`);

type ArtifactMetadata = {
  deviceRunSessionId: string;
  artifactId: string;
  name: string;
  filename: string;
  kind: string | undefined;
  metadata?: Record<string, unknown>;
  size: number;
};

type ArtifactSource = { stream: Readable; reopenStream?: () => Readable };

export async function uploadDeviceRunSessionArtifactAsync(
  ctx: CustomBuildContext,
  options: ArtifactMetadata & ArtifactSource & { signal?: AbortSignal }
): Promise<void> {
  try {
    await withDeviceRunSessionTimeoutAsync(
      { name: 'Artifact upload', timeoutMs: 300_000, signal: options.signal },
      async signal => {
        const uploadSession = await withDeviceRunSessionTimeoutAsync(
          { name: 'Artifact upload session creation', timeoutMs: 15_000, signal },
          async createSignal =>
            await createDeviceRunSessionArtifactUploadSessionAsync(ctx, options, createSignal)
        );
        signal.throwIfAborted();
        const attempts = options.reopenStream ? 3 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
          signal.throwIfAborted();
          const stream =
            attempt > 0 && options.reopenStream ? options.reopenStream() : options.stream;
          try {
            await withDeviceRunSessionTimeoutAsync(
              { name: 'Artifact PUT', timeoutMs: 90_000, signal },
              async putSignal => {
                const requestController = new AbortController();
                const destroy = () => {
                  stream.destroy();
                };
                putSignal.addEventListener('abort', destroy, { once: true });
                try {
                  const response = await fetch(uploadSession.url, {
                    method: 'PUT',
                    headers: new Headers(uploadSession.headers as Record<string, string>),
                    body: stream,
                    signal: AbortSignal.any([putSignal, requestController.signal]),
                  });
                  putSignal.throwIfAborted();
                  if (!response.ok) {
                    throw new ArtifactPutError(response.status);
                  }
                } finally {
                  // node-fetch's response stream is a PassThrough; destroying it leaves the socket open.
                  requestController.abort();
                  putSignal.removeEventListener('abort', destroy);
                  stream.destroy();
                }
              }
            );
            return;
          } catch (error) {
            signal.throwIfAborted();
            const retryable =
              error instanceof ArtifactPutError
                ? [408, 429, 500, 502, 503, 504].includes(error.status)
                : error instanceof Error &&
                  (error.name === 'FetchError' ||
                    error.name === 'AbortError' ||
                    error.message.startsWith('Artifact PUT timed out'));
            if (!retryable || attempt + 1 === attempts) {
              throw error;
            }
            await delay(500 * (attempt + 1), undefined, { signal });
          } finally {
            stream.destroy();
          }
        }
      }
    );
  } finally {
    // One-shot callers may have opened their stream before upload-session creation failed.
    options.stream.destroy();
  }
}

class ArtifactPutError extends SystemError {
  constructor(readonly status: number) {
    super(`Failed to upload device run session artifact: HTTP ${status}.`);
  }
}

async function createDeviceRunSessionArtifactUploadSessionAsync(
  ctx: CustomBuildContext,
  { deviceRunSessionId, artifactId, name, filename, kind, metadata, size }: ArtifactMetadata,
  signal: AbortSignal
) {
  const result = await ctx.graphqlClient
    .mutation(
      CREATE_DEVICE_RUN_SESSION_ARTIFACT_UPLOAD_SESSION_MUTATION,
      {
        deviceRunSessionId,
        input: {
          name,
          filename,
          ...(kind !== undefined ? { kind } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
          size,
        },
      },
      {
        // urql replaces fetchOptions.signal. Wrap fetch after it has resolved auth and its own signal.
        fetch: (input, init) =>
          globalThis.fetch(input, {
            ...init,
            signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
          }),
      }
    )
    .toPromise();
  signal.throwIfAborted();
  if (result.error) {
    throw new SystemError(
      `Failed to create upload session for device run session artifact ${artifactId}: ${result.error.message}`,
      { cause: result.error }
    );
  }
  return result.data!.deviceRunSession.createArtifactUploadSession.uploadSession;
}
