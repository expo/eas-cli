import { bunyan } from '@expo/logger';

export async function sleepAsync(ms: number): Promise<void> {
  await new Promise((res) => setTimeout(res, ms));
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
  }: {
    retryOptions: RetryOptions;
    logger?: bunyan;
  }
): Promise<T> {
  let attemptCount = -1;
  for (;;) {
    try {
      attemptCount += 1;
      return await fn(attemptCount);
    } catch (err: any) {
      logger?.debug(
        { err, stdout: err.stdout, stderr: err.stderr },
        `Retry attempt ${attemptCount}`
      );
      await sleepAsync(retryIntervalMs);
      if (attemptCount === retries) {
        throw err;
      }
    }
  }
}
