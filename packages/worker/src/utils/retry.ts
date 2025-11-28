import { bunyan } from '@expo/logger';
import { setTimeout } from 'timers/promises';

export interface RetryOptions {
  retries: number;
  retryIntervalMs: number;
}

export async function retry<T = void>(
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
      await setTimeout(retryIntervalMs);
      if (attemptCount === retries) {
        throw err;
      }
    }
  }
}
