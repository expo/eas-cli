import { OperationOptions } from 'retry';

import { promiseRetryWithCondition } from './promiseRetryWithCondition';

export function isDNSError(e: Error & { code: any }): boolean {
  return e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN';
}

export function retryOnDNSFailure<TFn extends (...args: any[]) => Promise<any>>(
  fn: TFn,
  options?: OperationOptions
): (...funcArgs: Parameters<TFn>) => Promise<ReturnType<TFn>> {
  return promiseRetryWithCondition(fn, isDNSError, {
    retries: 3,
    factor: 2,
    minTimeout: 100,
    ...options,
  });
}
