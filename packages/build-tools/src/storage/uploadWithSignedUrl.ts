import { SystemError } from '@expo/eas-build-job';
import fetch, { FetchError } from 'node-fetch';
import type { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { AbortUtils } from '../utils/AbortUtils';
import { isConnectFailure, isConnectionInterruptedError } from '../utils/networkErrors';

export type SignedUrl = {
  url: string;
  headers: Record<string, string>;
};

export type UploadWithSignedUrlParams = {
  signedUrl: SignedUrl;
  srcGeneratorAsync: () => Promise<Readable>;
};

export type UploadWithSignedUrlOptions = {
  signal?: AbortSignal;
  retries?: number;
  retryIntervalMs?: number;
  stallTimeoutMs?: number;
};

export async function uploadWithSignedUrl(
  { signedUrl, srcGeneratorAsync }: UploadWithSignedUrlParams,
  {
    signal,
    retries = 2,
    retryIntervalMs = 30_000,
    stallTimeoutMs = 90_000,
  }: UploadWithSignedUrlOptions = {}
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const stream = await srcGeneratorAsync();
    // Upload time scales with file size, so the deadline bounds stalls, not the whole request.
    const timeout = AbortUtils.resettableTimeout(stallTimeoutMs);
    try {
      await putAsync({
        signedUrl,
        stream,
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
        onProgress: timeout.resetDeadline,
      });
      return;
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt >= retries || (!timeout.signal.aborted && !isRetryableError(error))) {
        throw error;
      }
      await delay(retryIntervalMs * (attempt + 1), undefined, { signal });
    } finally {
      stream.destroy();
      await finished(stream).catch(() => {});
    }
  }
}

const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];
function isRetryableError(error: unknown): boolean {
  if (error instanceof SignedUrlUploadApiError && RETRYABLE_STATUSES.includes(error.status)) {
    return true;
  }
  return isConnectFailure(error) || isConnectionInterruptedError(error);
}

async function putAsync({
  signedUrl,
  stream,
  signal,
  onProgress,
}: {
  signedUrl: SignedUrl;
  stream: Readable;
  signal: AbortSignal;
  onProgress: () => void;
}): Promise<void> {
  const requestController = new AbortController();
  try {
    const responsePromise = fetch(signedUrl.url, {
      method: 'PUT',
      headers: signedUrl.headers,
      body: stream,
      signal: AbortSignal.any([signal, requestController.signal]),
    });
    // fetch has piped the body already, so this listener observes flow without starting it.
    stream.on('data', onProgress);

    const response = await responsePromise;
    signal.throwIfAborted();
    if (!response.ok) {
      throw new SignedUrlUploadApiError(response);
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof FetchError) {
      throw new SignedUrlUploadNetworkError(error);
    }
    throw error;
  } finally {
    // node-fetch destroys the request body on abort, and its response stream is a PassThrough
    // whose destruction leaves the socket open, so the request itself is aborted here.
    requestController.abort();
  }
}

export class SignedUrlUploadApiError extends SystemError {
  readonly status: number;
  readonly reason: string;

  constructor(response: { status: number; statusText: string }) {
    const reason = `HTTP ${response.status} ${response.statusText}`;
    super(`Signed URL upload failed: ${reason}.`);
    this.status = response.status;
    this.reason = reason;
  }
}

// node-fetch names the request URL in its message, which we want to avoid for signed urls.
export class SignedUrlUploadNetworkError extends SystemError {
  readonly code: string | undefined;
  readonly reason: string;

  constructor(error: FetchError) {
    const reason = error.code ?? 'network error';
    super(`Signed URL upload failed: ${reason}.`);
    this.code = error.code;
    this.reason = reason;
  }
}
