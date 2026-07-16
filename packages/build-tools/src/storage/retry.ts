import { Response } from 'node-fetch';

export type RetryOptions = {
  retries: number;
  retryIntervalMs: number;
};

interface RetryPolicy extends RetryOptions {
  shouldRetryOnError: (error: unknown) => boolean;
  shouldRetryOnResponse: (response: Response) => boolean;
}

export async function retryOnUploadFailure(
  fn: (attemptCount: number) => Promise<Response>,
  { retries, retryIntervalMs }: RetryOptions
): Promise<Response> {
  return await retry(fn, {
    retries,
    retryIntervalMs,
    shouldRetryOnError: error => {
      return (
        isErrorWithCode(error) &&
        (error.code === 'ENOTFOUND' ||
          error.code === 'EAI_AGAIN' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'EPIPE')
      );
    },
    shouldRetryOnResponse: response => {
      return [408, 429, 500, 502, 503, 504].includes(response.status);
    },
  });
}

function isErrorWithCode(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

async function retry(
  fn: (attemptCount: number) => Promise<Response>,
  { retries, retryIntervalMs, shouldRetryOnError, shouldRetryOnResponse }: RetryPolicy
): Promise<Response> {
  let attemptCount = -1;
  for (;;) {
    try {
      attemptCount += 1;
      const response = await fn(attemptCount);
      if (attemptCount < retries && shouldRetryOnResponse(response)) {
        await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
      } else {
        return response;
      }
    } catch (error: unknown) {
      if (attemptCount === retries || !shouldRetryOnError(error)) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }
  }
}
