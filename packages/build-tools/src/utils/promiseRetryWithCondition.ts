import promiseRetry from 'promise-retry';
import { OperationOptions } from 'retry';

export function promiseRetryWithCondition<TFn extends (...args: any[]) => Promise<any>>(
  fn: TFn,
  retryConditionFn: (error: any) => boolean,
  options: OperationOptions = { retries: 3, factor: 2 },
  onRetry?: (attemptNumber: number) => void
): (...funcArgs: Parameters<TFn>) => Promise<ReturnType<TFn>> {
  return (...funcArgs) =>
    promiseRetry<ReturnType<TFn>>(async (retry, attemptNumber) => {
      if (attemptNumber > 1) {
        onRetry?.(attemptNumber);
      }
      try {
        return await fn(...funcArgs);
      } catch (e) {
        if (retryConditionFn(e)) {
          retry(e);
        }
        throw e;
      }
    }, options);
}
