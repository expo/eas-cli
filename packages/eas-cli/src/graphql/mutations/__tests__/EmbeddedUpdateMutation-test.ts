import { CombinedError } from '@urql/core';

import {
  isEmbeddedUpdateAssetNotReadyError,
  isEmbeddedUpdateConflictError,
} from '../EmbeddedUpdateMutation';

function makeCombinedError(errorCode: string): CombinedError {
  return new CombinedError({
    graphQLErrors: [{ message: 'error', extensions: { errorCode } }],
  });
}

describe('isEmbeddedUpdateAssetNotReadyError', () => {
  it('returns true for CombinedError with EMBEDDED_UPDATE_ASSET_NOT_READY errorCode', () => {
    expect(
      isEmbeddedUpdateAssetNotReadyError(makeCombinedError('EMBEDDED_UPDATE_ASSET_NOT_READY'))
    ).toBe(true);
  });

  it('returns false for CombinedError with a different errorCode', () => {
    expect(
      isEmbeddedUpdateAssetNotReadyError(makeCombinedError('EMBEDDED_UPDATE_CONFLICT'))
    ).toBe(false);
  });

  it('returns false for CombinedError with no extensions', () => {
    expect(
      isEmbeddedUpdateAssetNotReadyError(new CombinedError({ graphQLErrors: [{ message: 'oops' }] }))
    ).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isEmbeddedUpdateAssetNotReadyError(new Error('plain error'))).toBe(false);
  });

  it('returns false for null and non-error values', () => {
    expect(isEmbeddedUpdateAssetNotReadyError(null)).toBe(false);
    expect(isEmbeddedUpdateAssetNotReadyError('string')).toBe(false);
    expect(isEmbeddedUpdateAssetNotReadyError(42)).toBe(false);
  });
});

describe('isEmbeddedUpdateConflictError', () => {
  it('returns true for CombinedError with EMBEDDED_UPDATE_CONFLICT errorCode', () => {
    expect(
      isEmbeddedUpdateConflictError(makeCombinedError('EMBEDDED_UPDATE_CONFLICT'))
    ).toBe(true);
  });

  it('returns false for CombinedError with a different errorCode', () => {
    expect(
      isEmbeddedUpdateConflictError(makeCombinedError('EMBEDDED_UPDATE_ASSET_NOT_READY'))
    ).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isEmbeddedUpdateConflictError(new Error('plain error'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEmbeddedUpdateConflictError(null)).toBe(false);
  });
});
