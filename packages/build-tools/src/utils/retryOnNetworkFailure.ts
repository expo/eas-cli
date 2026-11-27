import { CombinedError, OperationResult } from '@urql/core';

import { Datadog } from '../datadog';
import { findErrorCode, findGraphqlErrorCode, isTransientGraphqlError } from './networkErrors';
import { promiseRetryWithCondition } from './promiseRetryWithCondition';

export async function requestGraphqlDataWithRetriesAsync<TData>(
  attemptAsync: () => Promise<OperationResult<TData>>,
  { operation }: { operation: string }
): Promise<TData> {
  return await retryOnNetworkFailureAsync(
    async () => {
      const { data, error } = await attemptAsync();
      if (error) {
        throw error;
      }
      if (!data) {
        throw new Error('The response has no data.');
      }
      return data;
    },
    {
      operation,
      isRetryable: error => error instanceof CombinedError && isTransientGraphqlError(error),
    }
  );
}

export async function retryOnNetworkFailureAsync<T>(
  attemptAsync: () => Promise<T>,
  {
    operation,
    signal,
    isRetryable,
  }: {
    operation: string;
    signal?: AbortSignal;
    isRetryable: (error: unknown) => boolean;
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
      { retries: 5, minTimeout: 1_000, factor: 2 },
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
