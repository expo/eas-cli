import { CombinedError } from '@urql/core';

import Log from '../../log';
import {
  EAS_CLI_UPGRADE_REQUIRED_ERROR_CODE,
  withErrorHandlingAsync,
  withUpgradeRequiredErrorHandlingAsync,
} from '../client';

jest.mock('../../log');

function makeError(message: string, extensions?: Record<string, unknown>): CombinedError {
  return new CombinedError({
    graphQLErrors: [{ message, extensions } as any],
  });
}

const mockLogError = jest.mocked(Log.error);

describe(withErrorHandlingAsync, () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs the transient error message for generic transient errors', async () => {
    const error = makeError('Transient failure', {
      isTransient: true,
      errorCode: 'SOME_TRANSIENT',
    });
    await expect(withErrorHandlingAsync(Promise.resolve({ error } as any))).rejects.toBe(error);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("We've encountered a transient error")
    );
  });

  it('suppresses the transient error message for EMBEDDED_UPDATE_ASSET_NOT_AVAILABLE', async () => {
    const error = makeError('Asset not yet available', {
      isTransient: true,
      errorCode: 'EMBEDDED_UPDATE_ASSET_NOT_AVAILABLE',
    });
    await expect(withErrorHandlingAsync(Promise.resolve({ error } as any))).rejects.toBe(error);
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

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
