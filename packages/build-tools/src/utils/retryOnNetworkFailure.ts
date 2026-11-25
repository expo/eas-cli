import { Datadog } from '../datadog';
import { findErrorCode, findGraphqlErrorCode } from './networkErrors';
import { promiseRetryWithCondition } from './promiseRetryWithCondition';

export async function retryOnNetworkFailureAsync<T>(
  attemptAsync: () => Promise<T>,
  {
    operation,
    signal,
    isRetryable,
    retries = 5,
    minTimeoutMs = 1_000,
  }: {
    operation: string;
    signal?: AbortSignal;
    isRetryable: (error: unknown) => boolean;
    retries?: number;
    /** The wait before the first retry. Each later wait is two times the wait before it. */
    minTimeoutMs?: number;
  }
): Promise<T> {
  const shouldRetry = (error: unknown): boolean => !signal?.aborted && isRetryable(error);
  let attempts = 1;
  let lastError: unknown;
  const report = (outcome: 'recovered' | 'failed', error: unknown): void => {
    Datadog.log(`${operation} ${outcome} on attempt ${attempts}`, {
      event: 'network_retry',
      operation,
      outcome,
      attempts: String(attempts),
      code: findErrorCode(error) ?? findGraphqlErrorCode(error) ?? 'unknown',
    });
  };

  try {
    const result = await promiseRetryWithCondition(
      async () => {
        signal?.throwIfAborted();
        return await attemptAsync();
      },
      shouldRetry,
      { retries, minTimeout: minTimeoutMs, factor: 2 },
      ({ attemptNumber, error }) => {
        attempts = attemptNumber;
        lastError = error;
      }
    )();
    if (attempts > 1) {
      report('recovered', lastError);
    }
    return result;
  } catch (error) {
    if (attempts > 1 && !signal?.aborted) {
      report('failed', error);
    }
    throw error;
  }
}
