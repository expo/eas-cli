import { CombinedError as GraphqlError, OperationResult } from '@urql/core';

import Log from '../log';

export async function withErrorHandlingAsync<T>(promise: Promise<OperationResult<T>>): Promise<T> {
  const { data, error } = await promise;

  if (error) {
    if (
      error.graphQLErrors.some(
        e =>
          e?.extensions?.isTransient &&
          ![
            'EAS_BUILD_FREE_TIER_LIMIT_EXCEEDED',
            'EAS_BUILD_FREE_TIER_IOS_LIMIT_EXCEEDED',
          ].includes(e?.extensions?.errorCode as string)
      )
    ) {
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
