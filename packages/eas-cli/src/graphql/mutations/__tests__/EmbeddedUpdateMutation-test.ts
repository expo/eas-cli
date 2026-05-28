import { CombinedError } from '@urql/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../../generated';
import {
  EmbeddedUpdateMutation,
  isEmbeddedUpdateAlreadyExistsError,
  isEmbeddedUpdateAssetNotAvailableError,
} from '../EmbeddedUpdateMutation';

function makeGraphqlClient(data: unknown): ExpoGraphqlClient {
  return {
    mutation: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({ data }),
    }),
  } as unknown as ExpoGraphqlClient;
}

function makeCombinedError(errorCode: string): CombinedError {
  return new CombinedError({
    graphQLErrors: [{ message: 'error', extensions: { errorCode } }],
  });
}

describe('isEmbeddedUpdateAssetNotAvailableError', () => {
  it('returns true for CombinedError with EMBEDDED_UPDATE_ASSET_NOT_AVAILABLE errorCode', () => {
    expect(
      isEmbeddedUpdateAssetNotAvailableError(
        makeCombinedError('EMBEDDED_UPDATE_ASSET_NOT_AVAILABLE')
      )
    ).toBe(true);
  });

  it('returns false for CombinedError with a different errorCode', () => {
    expect(isEmbeddedUpdateAssetNotAvailableError(makeCombinedError('SOME_OTHER_ERROR'))).toBe(
      false
    );
  });

  it('returns false for CombinedError with no extensions', () => {
    expect(
      isEmbeddedUpdateAssetNotAvailableError(
        new CombinedError({ graphQLErrors: [{ message: 'oops' }] })
      )
    ).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isEmbeddedUpdateAssetNotAvailableError(new Error('plain error'))).toBe(false);
  });

  it('returns false for null and non-error values', () => {
    expect(isEmbeddedUpdateAssetNotAvailableError(null)).toBe(false);
    expect(isEmbeddedUpdateAssetNotAvailableError('string')).toBe(false);
    expect(isEmbeddedUpdateAssetNotAvailableError(42)).toBe(false);
  });
});

describe('isEmbeddedUpdateAlreadyExistsError', () => {
  it('returns true for CombinedError with EMBEDDED_UPDATE_ALREADY_EXISTS errorCode', () => {
    expect(
      isEmbeddedUpdateAlreadyExistsError(makeCombinedError('EMBEDDED_UPDATE_ALREADY_EXISTS'))
    ).toBe(true);
  });

  it('returns false for CombinedError with a different errorCode', () => {
    expect(isEmbeddedUpdateAlreadyExistsError(makeCombinedError('SOME_OTHER_ERROR'))).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isEmbeddedUpdateAlreadyExistsError(new Error('plain error'))).toBe(false);
  });
});

describe('EmbeddedUpdateMutation.uploadEmbeddedUpdateAsync', () => {
  it('returns the embedded update from the GraphQL response', async () => {
    const expected = {
      id: 'update-1',
      platform: AppPlatform.Android,
      runtimeVersion: '1.0.0',
      channel: 'production',
      createdAt: '2024-01-01T00:00:00Z',
    };
    const client = makeGraphqlClient({
      embeddedUpdate: { uploadEmbeddedUpdate: expected },
    });

    const result = await EmbeddedUpdateMutation.uploadEmbeddedUpdateAsync(client, {
      appId: 'app-1',
      platform: AppPlatform.Android,
      runtimeVersion: '1.0.0',
      channel: 'production',
      embeddedUpdateId: 'update-1',
      turtleBuildId: null,
    });

    expect(result).toEqual(expected);
  });
});
