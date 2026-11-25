import { asyncResult } from '@expo/results';
import fetch, { FetchError, type Response } from 'node-fetch';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { RETRYABLE_HTTP_STATUSES, findErrorCode, isTransferFailure } from '../utils/networkErrors';
import { retryOnNetworkFailureAsync } from '../utils/retryOnNetworkFailure';

export type DownloadToFileParams = {
  url: string;
  headers?: Record<string, string>;
  /** A function gets the response of the attempt, for a file name that comes from the response. */
  destinationPath: string | ((response: Response) => string);
};

export type DownloadToFileOptions = {
  /** Names the download in the network retry logs. */
  operation: string;
  /** Stops the request and the file write when aborted. */
  signal?: AbortSignal;
};

/** Downloads the URL to a file and returns the path of the file. */
export async function downloadToFileAsync(
  { url, headers, destinationPath }: DownloadToFileParams,
  { operation, signal }: DownloadToFileOptions
): Promise<string> {
  signal?.throwIfAborted();
  let filePath: string;
  try {
    filePath = await retryOnNetworkFailureAsync(
      async () => {
        const response = await fetch(url, { headers, signal });
        if (!response.ok) {
          const textResult = await asyncResult(response.text());
          throw new DownloadApiError({
            status: response.status,
            statusText: response.statusText,
            responseText: textResult.value,
          });
        }
        const attemptFilePath =
          typeof destinationPath === 'string' ? destinationPath : destinationPath(response);
        try {
          // On abort, node-fetch emits an error on the body stream, which fails the pipeline.
          await pipeline(response.body, fs.createWriteStream(attemptFilePath));
        } catch (error) {
          await fs.promises.rm(attemptFilePath, { force: true });
          throw error;
        }
        return attemptFilePath;
      },
      { operation, signal, isRetryable: isRetryableError }
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof FetchError || isTransferFailure(error)) {
      throw new DownloadNetworkError(error);
    }
    throw error;
  }
  signal?.throwIfAborted();
  return filePath;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof DownloadApiError) {
    return RETRYABLE_HTTP_STATUSES.includes(error.status);
  }
  return isTransferFailure(error);
}

// The URL can come from the user, so the caller decides whether a failure is a system error.
export class DownloadApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly responseText: string | undefined;

  constructor({
    status,
    statusText,
    responseText,
  }: {
    status: number;
    statusText: string;
    responseText: string | undefined;
  }) {
    super(`Download failed: HTTP ${status} ${statusText}.`);
    this.status = status;
    this.statusText = statusText;
    this.responseText = responseText;
  }
}

// node-fetch names the request URL in its message, which we want to avoid for signed urls.
export class DownloadNetworkError extends Error {
  readonly code: string | undefined;
  readonly reason: string;

  constructor(error: unknown) {
    const code = findErrorCode(error);
    const reason = code ?? 'network error';
    super(`Download failed: ${reason}.`);
    this.code = code;
    this.reason = reason;
  }
}
