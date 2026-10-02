import promiseRetry from 'promise-retry';
import { WrapOptions } from 'retry';

export function promiseRetryWithCondition<TFn extends (...args: any[]) => Promise<any>>(
  fn: TFn,
  retryConditionFn: (error: any) => boolean,
  options: WrapOptions = { retries: 3, factor: 2 },
  onRetry?: (params: { attemptNumber: number; maxAttemptsCount: number; error: unknown }) => void
): (...funcArgs: Parameters<TFn>) => Promise<ReturnType<TFn>> {
  return (...funcArgs) => {
    let lastError: unknown;
    const maxAttemptsCount = options.forever ? Infinity : (options.retries ?? 10) + 1;
    return promiseRetry<ReturnType<TFn>>(async (retry, attemptNumber) => {
      if (attemptNumber > 1) {
        onRetry?.({ attemptNumber, maxAttemptsCount, error: lastError });
      }
      try {
        return await fn(...funcArgs);
      } catch (e) {
        if (retryConditionFn(e)) {
          lastError = e;
          retry(e);
        }
        throw e;
      }
    }, options);
  };
}
