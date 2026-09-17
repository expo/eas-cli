import { SystemError } from '@expo/eas-build-job';
import { graphql } from 'gql.tada';
import fetch, { Headers } from 'node-fetch';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { CustomBuildContext } from '../../customBuildContext';
import {
  DeviceRunSessionTimeoutError,
  withDeviceRunSessionTimeoutAsync,
} from './deviceRunSessionTimeout';

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
    const uploadSession = await withDeviceRunSessionTimeoutAsync(
      { name: 'Artifact upload session creation', timeoutMs: 15_000, signal: options.signal },
      async signal => await createDeviceRunSessionArtifactUploadSessionAsync(ctx, options, signal)
    );
    options.signal?.throwIfAborted();
    await putArtifactWithRetriesAsync({
      uploadSession,
      source: options,
      artifactId: options.artifactId,
      signal: options.signal,
    });
  } finally {
    // One-shot callers may have opened their stream before upload-session creation failed.
    options.stream.destroy();
  }
}

async function putArtifactWithRetriesAsync({
  uploadSession,
  source,
  artifactId,
  signal,
}: {
  uploadSession: ArtifactUploadSession;
  source: ArtifactSource;
  artifactId: string;
  signal?: AbortSignal;
}): Promise<void> {
  const attempts = source.reopenStream ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    const stream = attempt > 0 && source.reopenStream ? source.reopenStream() : source.stream;
    try {
      // Upload time scales with file size, so the deadline bounds stalls, not the whole request.
      await withDeviceRunSessionTimeoutAsync(
        { name: 'Artifact PUT', timeoutMs: 90_000, signal },
        async (putSignal, resetDeadline) =>
          await putArtifactAsync({
            uploadSession,
            stream,
            artifactId,
            signal: putSignal,
            onProgress: resetDeadline,
          })
      );
      return;
    } catch (error) {
      signal?.throwIfAborted();
      const retryable =
        error instanceof ArtifactPutError
          ? [408, 429, 500, 502, 503, 504].includes(error.status)
          : error instanceof DeviceRunSessionTimeoutError ||
            (error instanceof Error && error.name === 'FetchError');
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
  artifactId,
  signal,
  onProgress,
}: {
  uploadSession: ArtifactUploadSession;
  stream: Readable;
  artifactId: string;
  signal: AbortSignal;
  onProgress: () => void;
}): Promise<void> {
  const requestController = new AbortController();
  try {
    const responding = fetch(uploadSession.url, {
      method: 'PUT',
      headers: new Headers(uploadSession.headers as Record<string, string>),
      body: stream,
      signal: AbortSignal.any([signal, requestController.signal]),
    });
    // fetch has piped the body already, so this listener observes flow without starting it.
    stream.on('data', onProgress);
    const response = await responding;
    signal.throwIfAborted();
    if (!response.ok) {
      throw new ArtifactPutError(artifactId, response);
    }
  } finally {
    // node-fetch destroys the request body on abort, and its response stream is a PassThrough
    // whose destruction leaves the socket open, so the request itself is aborted here.
    requestController.abort();
  }
}

class ArtifactPutError extends SystemError {
  readonly status: number;

  constructor(artifactId: string, response: { status: number; statusText: string }) {
    super(
      `Failed to upload device run session artifact ${artifactId}: HTTP ${response.status} ${response.statusText}.`
    );
    this.status = response.status;
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
