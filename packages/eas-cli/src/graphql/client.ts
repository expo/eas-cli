import { CombinedError as GraphqlError, OperationResult } from '@urql/core';

import Log from '../log';

export async function withErrorHandlingAsync<T>(promise: Promise<OperationResult<T>>): Promise<T> {
  const { data, error } = await promise;

  if (error) {
    if (error.graphQLErrors.some(e => e?.extensions?.isTransient)) {
      Log.error(`We've encountered a transient error. Try again shortly.`);
    }
    throw error;
  }

  // Check for malformed response. This only checks the root query existence,
  // It doesn't affect returning responses with empty resultset.
  if (!data) {
    throw new Error('Returned query result data is null!');
  }

  return data;
}

export { GraphqlError };
