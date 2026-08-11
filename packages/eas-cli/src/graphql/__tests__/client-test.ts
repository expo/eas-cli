import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import Log from '../../log';
import {
  EAS_CLI_UPGRADE_REQUIRED_ERROR_CODE,
  isPermanentGraphqlError,
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

describe(isPermanentGraphqlError, () => {
  it('is true for user errors', () => {
    expect(isPermanentGraphqlError(makeError('Not authorized', { errorType: 'USER' }))).toBe(true);
  });

  it('is false for network errors', () => {
    expect(isPermanentGraphqlError(new CombinedError({ networkError: new Error('offline') }))).toBe(
      false
    );
  });

  it('is false for server faults', () => {
    expect(isPermanentGraphqlError(makeError('Unexpected', { errorType: 'SYSTEM' }))).toBe(false);
  });

  it('is false for user errors the server marks transient', () => {
    expect(
      isPermanentGraphqlError(makeError('Locked', { errorType: 'USER', isTransient: true }))
    ).toBe(false);
  });

  it('is false when any error in the response is not a user error', () => {
    const mixed = new CombinedError({
      graphQLErrors: [
        new GraphQLError('Not authorized', { extensions: { errorType: 'USER' } }),
        new GraphQLError('Unexpected', { extensions: { errorType: 'SYSTEM' } }),
      ],
    });
    expect(isPermanentGraphqlError(mixed)).toBe(false);
  });

  it('is false for unclassified GraphQL errors', () => {
    expect(isPermanentGraphqlError(makeError('Something'))).toBe(false);
  });

  it('is false for errors that are not GraphQL errors', () => {
    expect(isPermanentGraphqlError(new Error('boom'))).toBe(false);
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
