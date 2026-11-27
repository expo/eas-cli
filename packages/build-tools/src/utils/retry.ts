import { bunyan } from '@expo/logger';

export async function sleepAsync(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>(res => {
    const onAbort = (): void => {
      clearTimeout(timer);
      res();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      res();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RetryOptions {
  retries: number;
  retryIntervalMs: number;
}

export async function retryAsync<T = void>(
  fn: (attemptCount: number) => Promise<T>,
  {
    retryOptions: { retries, retryIntervalMs },
    logger,
    shouldRetry,
    signal,
  }: {
    retryOptions: RetryOptions;
    logger?: bunyan;
    shouldRetry?: (err: unknown) => boolean;
    signal?: AbortSignal;
  }
): Promise<T> {
  let attemptCount = -1;
  for (;;) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Retry aborted.');
    }
    try {
      attemptCount += 1;
      return await fn(attemptCount);
    } catch (err: any) {
      logger?.debug(
        { err, stdout: err.stdout, stderr: err.stderr },
        `Retry attempt ${attemptCount}`
      );
      if (signal?.aborted || (shouldRetry && !shouldRetry(err)) || attemptCount === retries) {
        throw err;
      }
      await sleepAsync(retryIntervalMs, signal);
      if (signal?.aborted) {
        throw err;
      }
    }
  }
}
