import { SystemError } from '@expo/eas-build-job';
import fetch, { Headers } from 'node-fetch';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { OperationTimeoutError, withTimeoutAsync } from '../../utils/timeout';

export type ArtifactUploadSession = { url: string; headers: unknown };
export type ArtifactSource = { stream: Readable; reopenStream?: () => Readable };

export async function putArtifactWithRetriesAsync({
  uploadSession,
  source,
  signal,
}: {
  uploadSession: ArtifactUploadSession;
  source: ArtifactSource;
  signal?: AbortSignal;
}): Promise<void> {
  const attempts = source.reopenStream ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    const stream = attempt > 0 && source.reopenStream ? source.reopenStream() : source.stream;
    try {
      // Upload time scales with file size, so the deadline bounds stalls, not the whole request.
      await withTimeoutAsync(
        { name: 'Artifact PUT', timeoutMs: 90_000, signal },
        async (putSignal, resetDeadline) =>
          await putArtifactAsync({
            uploadSession,
            stream,
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
          : error instanceof OperationTimeoutError || error instanceof ArtifactPutNetworkError;
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
  onProgress,
}: {
  uploadSession: ArtifactUploadSession;
  stream: Readable;
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
    let response;
    try {
      response = await responding;
    } catch (error) {
      throw error instanceof Error && error.name === 'FetchError'
        ? new ArtifactPutNetworkError(error)
        : error;
    }
    signal.throwIfAborted();
    if (!response.ok) {
      throw new ArtifactPutError(response);
    }
  } finally {
    // node-fetch destroys the request body on abort, and its response stream is a PassThrough
    // whose destruction leaves the socket open, so the request itself is aborted here.
    requestController.abort();
  }
}

export class ArtifactPutError extends SystemError {
  readonly status: number;
  readonly reason: string;

  constructor(response: { status: number; statusText: string }) {
    const reason = `HTTP ${response.status} ${response.statusText}`;
    super(`Artifact PUT failed: ${reason}.`);
    this.status = response.status;
    this.reason = reason;
  }
}

// node-fetch names the request URL in its message, and here that URL is signed. The message keeps
// only the error code, and the original is not kept as the cause because loggers and Sentry print causes.
export class ArtifactPutNetworkError extends SystemError {
  readonly code: string | undefined;
  readonly reason: string;

  constructor(error: Error & { code?: unknown }) {
    const code = typeof error.code === 'string' ? error.code : undefined;
    const reason = code ?? 'network error';
    super(`Artifact PUT failed: ${reason}.`);
    this.code = code;
    this.reason = reason;
  }
}
