import { CombinedError } from '@urql/core';

import {
  EAS_CLI_UPGRADE_REQUIRED_ERROR_CODE,
  withUpgradeRequiredErrorHandlingAsync,
} from '../client';

function makeError(message: string, extensions?: Record<string, unknown>): CombinedError {
  return new CombinedError({
    graphQLErrors: [{ message, extensions } as any],
  });
}

describe(withUpgradeRequiredErrorHandlingAsync, () => {
  it('returns data when the promise resolves successfully', async () => {
    const result = await withUpgradeRequiredErrorHandlingAsync(
      Promise.resolve({ data: { foo: 'bar' } } as any),
      { featureName: 'feature' }
    );
    expect(result).toEqual({ foo: 'bar' });
  });

  it('throws an upgrade-required error when the server returns the matching errorCode', async () => {
    const error = makeError('Schema changed', { errorCode: EAS_CLI_UPGRADE_REQUIRED_ERROR_CODE });
    await expect(
      withUpgradeRequiredErrorHandlingAsync(Promise.resolve({ error } as any), {
        featureName: 'EAS Update insights',
      })
    ).rejects.toThrow(/EAS Update insights is not supported by this version of eas-cli/);
  });

  it('throws an upgrade-required error when the server returns a "Cannot query field" validation error', async () => {
    const error = makeError('Cannot query field "newField" on type "UpdateInsights".');
    await expect(
      withUpgradeRequiredErrorHandlingAsync(Promise.resolve({ error } as any), {
        featureName: 'feature',
      })
    ).rejects.toThrow(/not supported by this version of eas-cli/);
  });

  it('rethrows other GraphQL errors as-is', async () => {
    const error = makeError('Random other error', { errorCode: 'SOMETHING_ELSE' });
    await expect(
      withUpgradeRequiredErrorHandlingAsync(Promise.resolve({ error } as any), {
        featureName: 'feature',
      })
    ).rejects.toBe(error);
  });
});
