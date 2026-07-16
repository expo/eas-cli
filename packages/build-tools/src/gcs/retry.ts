import { Response } from 'node-fetch';

type RetryOptions = {
  retries: number;
  retryIntervalMs: number;
  shouldRetryOnError: (error: unknown) => boolean;
  shouldRetryOnResponse: (response: Response) => boolean;
};

// based on https://github.com/googleapis/nodejs-storage/blob/8ab50804fc7bae3bbd159bbb4adf65c02215b11b/src/storage.ts#L284-L320
export async function retryOnGCSUploadFailure(
  fn: (attemptCount: number) => Promise<Response>,
  {
    retries,
    retryIntervalMs,
  }: { retries: RetryOptions['retries']; retryIntervalMs: RetryOptions['retryIntervalMs'] }
): Promise<Response> {
  return await retry(fn, {
    retries,
    retryIntervalMs,
    shouldRetryOnError: err => {
      return (
        isErrorWithCode(err) &&
        (err.code === 'ENOTFOUND' ||
          err.code === 'EAI_AGAIN' ||
          err.code === 'ECONNRESET' ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'EPIPE')
      );
    },
    shouldRetryOnResponse: resp => {
      return [408, 429, 500, 502, 503, 504].includes(resp.status);
    },
  });
}

function isErrorWithCode(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/**
 * Wrapper used to execute an inner function and possibly retry it if it throws an error
 * @param fn Function to be executed and retried in case of error
 * @param retries How many times at most should the function be retried
 * @param retryIntervalMs Time interval between the retries
 * @param shouldRetryOnError Function that determines if the function should be retried based on the error thrown
 * @param shouldRetryOnResponse Function that determines if the function should be retried based on the response
 */
async function retry(
  fn: (attemptCount: number) => Promise<Response>,
  { retries, retryIntervalMs, shouldRetryOnError, shouldRetryOnResponse }: RetryOptions
): Promise<Response> {
  let attemptCount = -1;
  for (;;) {
    try {
      attemptCount += 1;
      const resp = await fn(attemptCount);
      if (attemptCount < retries && shouldRetryOnResponse(resp)) {
        await new Promise(res => setTimeout(res, retryIntervalMs));
      } else {
        return resp;
      }
    } catch (err: unknown) {
      if (attemptCount === retries || !shouldRetryOnError(err)) {
        throw err;
      }
      await new Promise(res => setTimeout(res, retryIntervalMs));
    }
  }
}
