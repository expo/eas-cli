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
type ArtifactUploadSession = Awaited<
  ReturnType<typeof createDeviceRunSessionArtifactUploadSessionAsync>
>;

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
        await putArtifactWithRetriesAsync({ uploadSession, source: options, signal });
      }
    );
  } finally {
    // One-shot callers may have opened their stream before upload-session creation failed.
    options.stream.destroy();
  }
}

async function putArtifactWithRetriesAsync({
  uploadSession,
  source,
  signal,
}: {
  uploadSession: ArtifactUploadSession;
  source: ArtifactSource;
  signal: AbortSignal;
}): Promise<void> {
  const attempts = source.reopenStream ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal.throwIfAborted();
    const stream = attempt > 0 && source.reopenStream ? source.reopenStream() : source.stream;
    try {
      await withDeviceRunSessionTimeoutAsync(
        { name: 'Artifact PUT', timeoutMs: 90_000, signal },
        async putSignal => await putArtifactAsync({ uploadSession, stream, signal: putSignal })
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

async function putArtifactAsync({
  uploadSession,
  stream,
  signal,
}: {
  uploadSession: ArtifactUploadSession;
  stream: Readable;
  signal: AbortSignal;
}): Promise<void> {
  const requestController = new AbortController();
  const destroy = () => {
    stream.destroy();
  };
  signal.addEventListener('abort', destroy, { once: true });
  try {
    const response = await fetch(uploadSession.url, {
      method: 'PUT',
      headers: new Headers(uploadSession.headers as Record<string, string>),
      body: stream,
      signal: AbortSignal.any([signal, requestController.signal]),
    });
    signal.throwIfAborted();
    if (!response.ok) {
      throw new ArtifactPutError(response.status);
    }
  } finally {
    // node-fetch's response stream is a PassThrough; destroying it leaves the socket open.
    requestController.abort();
    signal.removeEventListener('abort', destroy);
    stream.destroy();
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
