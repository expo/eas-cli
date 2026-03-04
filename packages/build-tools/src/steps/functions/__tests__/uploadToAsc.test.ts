import { isClosedVersionTrainError, isInvalidBundleIdentifierError } from '../uploadToAsc';

describe(isClosedVersionTrainError, () => {
  it('returns true when all errors are closed-version-train codes', () => {
    expect(
      isClosedVersionTrainError([{ code: '90062' }, { code: '90186' }, { code: '90062' }])
    ).toBe(true);
  });

  it('returns false when any other error code is present', () => {
    expect(
      isClosedVersionTrainError([{ code: '90062' }, { code: '90186' }, { code: '12345' }])
    ).toBe(false);
  });

  it('returns false when there are no errors', () => {
    expect(isClosedVersionTrainError([])).toBe(false);
  });
});

describe(isInvalidBundleIdentifierError, () => {
  it('returns true when all errors are invalid-bundle-id codes', () => {
    expect(
      isInvalidBundleIdentifierError([
        { code: '90054' },
        { code: '90055' },
        { code: '90055' },
      ])
    ).toBe(true);
  });

  it('returns false when any other error code is present', () => {
    expect(isInvalidBundleIdentifierError([{ code: '90055' }, { code: '90713' }])).toBe(false);
  });

  it('returns false when there are no errors', () => {
    expect(isInvalidBundleIdentifierError([])).toBe(false);
  });
});
