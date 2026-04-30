import { CombinedError as GraphqlError, OperationResult } from '@urql/core';

import { EasCommandError } from '../commandUtils/errors';
import Log from '../log';

export const EAS_CLI_UPGRADE_REQUIRED_ERROR_CODE = 'EAS_CLI_UPGRADE_REQUIRED';

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

/**
 * Wraps `withErrorHandlingAsync` for queries that hit endpoints which may evolve in
 * ways that require a newer eas-cli. The server signals this by returning a GraphQL
 * error with `extensions.errorCode === EAS_CLI_UPGRADE_REQUIRED`. As a fallback we
 * also detect schema validation errors of the form `Cannot query field "X" on type "Y"`,
 * which surface when a field has been removed without a coded error.
 *
 * In either case we re-throw an `EasCommandError` instructing the user to upgrade.
 */
export async function withUpgradeRequiredErrorHandlingAsync<T>(
  promise: Promise<OperationResult<T>>,
  { featureName }: { featureName: string }
): Promise<T> {
  try {
    return await withErrorHandlingAsync(promise);
  } catch (error) {
    if (isUpgradeRequiredError(error)) {
      throw new EasCommandError(
        `${featureName} is not supported by this version of eas-cli. ` +
          `Upgrade to the latest version: \`npm install -g eas-cli@latest\`.`
      );
    }
    throw error;
  }
}

function isUpgradeRequiredError(error: unknown): boolean {
  if (!(error instanceof GraphqlError)) {
    return false;
  }
  return error.graphQLErrors.some(e => {
    if (e?.extensions?.errorCode === EAS_CLI_UPGRADE_REQUIRED_ERROR_CODE) {
      return true;
    }
    return /Cannot query field ".+" on type ".+"/.test(e?.message ?? '');
  });
}

export { GraphqlError };
