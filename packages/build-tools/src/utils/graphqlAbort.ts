import type { OperationContext } from '@urql/core';

/**
 * urql replaces `fetchOptions.signal` with its own, so a caller's signal has to be joined into
 * fetch after urql has resolved auth and its signal. Returns nothing without a signal, so the
 * client's default fetch stays in use.
 */
export function graphqlAbortContext(
  signal: AbortSignal | undefined
): Pick<OperationContext, 'fetch'> | undefined {
  if (!signal) {
    return undefined;
  }
  return {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
      }),
  };
}
