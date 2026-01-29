import { Response } from 'node-fetch';

export interface RetryOptions {
  retries: number;
  retryIntervalMs: number;
  shouldRetryOnError: (error: any) => boolean;
  shouldRetryOnResponse: (response: Response) => boolean;
}

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
    shouldRetryOnError: (e) => {
      return (
        e.code === 'ENOTFOUND' ||
        e.code === 'EAI_AGAIN' ||
        e.code === 'ECONNRESET' ||
        e.code === 'ETIMEDOUT' ||
        e.code === 'EPIPE'
      );
    },
    shouldRetryOnResponse: (resp) => {
      return [408, 429, 500, 502, 503, 504].includes(resp.status);
    },
  });
}

/**
 * Wrapper used to execute an inner function and possibly retry it if it throws and error
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
        await new Promise((res) => setTimeout(res, retryIntervalMs));
      } else {
        return resp;
      }
    } catch (err: any) {
      if (attemptCount === retries || !shouldRetryOnError(err)) {
        throw err;
      }
      await new Promise((res) => setTimeout(res, retryIntervalMs));
    }
  }
}
