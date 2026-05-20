import { CombinedError } from '@urql/core';

import { isEmbeddedUpdateAssetNotAvailableError } from '../EmbeddedUpdateMutation';

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
