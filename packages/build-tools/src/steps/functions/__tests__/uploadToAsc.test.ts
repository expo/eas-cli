import {
  isClosedVersionTrainError,
  isInvalidBundleIdentifierError,
  isMissingPurposeStringError,
  parseMissingUsageDescriptionKeys,
} from '../uploadToAsc';

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
      isInvalidBundleIdentifierError([{ code: '90054' }, { code: '90055' }, { code: '90055' }])
    ).toBe(true);
  });

  it('returns false when any other error code is present', () => {
    expect(isInvalidBundleIdentifierError([{ code: '90055' }, { code: '90713' }])).toBe(false);
  });

  it('returns false when there are no errors', () => {
    expect(isInvalidBundleIdentifierError([])).toBe(false);
  });
});

describe(isMissingPurposeStringError, () => {
  it('returns true when all errors are missing-purpose-string codes', () => {
    expect(isMissingPurposeStringError([{ code: '90683' }, { code: '90683' }])).toBe(true);
  });

  it('returns false when any other error code is present', () => {
    expect(isMissingPurposeStringError([{ code: '90683' }, { code: '90054' }])).toBe(false);
  });

  it('returns false when there are no errors', () => {
    expect(isMissingPurposeStringError([])).toBe(false);
  });
});

describe(parseMissingUsageDescriptionKeys, () => {
  it('extracts missing UsageDescription keys from ASC messages', () => {
    expect(
      parseMissingUsageDescriptionKeys([
        {
          description:
            'The Info.plist file should contain a NSPhotoLibraryUsageDescription key with a user-facing purpose string. (90683)',
        },
        {
          description:
            'The Info.plist file should contain a NSCameraUsageDescription key with a user-facing purpose string. (90683)',
        },
      ])
    ).toEqual(['NSPhotoLibraryUsageDescription', 'NSCameraUsageDescription']);
  });

  it('deduplicates repeated keys', () => {
    expect(
      parseMissingUsageDescriptionKeys([
        {
          description:
            'The Info.plist file should contain a NSCameraUsageDescription key with a user-facing purpose string. (90683)',
        },
        {
          description:
            'The Info.plist file should contain a NSCameraUsageDescription key with a user-facing purpose string. (90683)',
        },
      ])
    ).toEqual(['NSCameraUsageDescription']);
  });

  it('returns an empty array when no usage description key is present', () => {
    expect(
      parseMissingUsageDescriptionKeys([{ description: 'Some other upload validation error.' }])
    ).toEqual([]);
  });
});
