import promiseRetry from 'promise-retry';
import { OperationOptions } from 'retry';

export function promiseRetryWithCondition<TFn extends (...args: any[]) => Promise<any>>(
  fn: TFn,
  retryConditionFn: (error: any) => boolean,
  options: OperationOptions = { retries: 3, factor: 2 }
): (...funcArgs: Parameters<TFn>) => Promise<ReturnType<TFn>> {
  return (...funcArgs) =>
    promiseRetry<ReturnType<TFn>>(async (retry) => {
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
