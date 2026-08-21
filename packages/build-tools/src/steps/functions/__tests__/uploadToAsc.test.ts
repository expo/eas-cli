import * as jose from 'jose';

import {
  createAscApiTokenAsync,
  isClosedVersionTrainError,
  isInvalidBundleIdentifierError,
  isMissingPurposeStringError,
  isSdkVersionIssueError,
  parseMissingUsageDescriptionKeys,
} from '../uploadToAsc';

describe(createAscApiTokenAsync, () => {
  let keyPem: string;

  beforeAll(async () => {
    const { privateKey } = await jose.generateKeyPair('ES256', { extractable: true });
    keyPem = await jose.exportPKCS8(privateKey);
  });

  it('signs a team key JWT with iss and without sub', async () => {
    const token = await createAscApiTokenAsync({
      issuer_id: '6053b7fe-68a8-4acb-89be-165aa6465141',
      key_id: 'D383SF739',
      key: keyPem,
    });

    const header = jose.decodeProtectedHeader(token);
    expect(header).toMatchObject({ alg: 'ES256', kid: 'D383SF739' });

    const payload = jose.decodeJwt(token);
    expect(payload.iss).toBe('6053b7fe-68a8-4acb-89be-165aa6465141');
    expect(payload.sub).toBeUndefined();
    expect(payload.aud).toBe('appstoreconnect-v1');
  });

  it('signs an individual key JWT with sub "user" and without iss', async () => {
    const token = await createAscApiTokenAsync({
      key_id: 'D383SF739',
      key: keyPem,
    });

    const header = jose.decodeProtectedHeader(token);
    expect(header).toMatchObject({ alg: 'ES256', kid: 'D383SF739' });

    const payload = jose.decodeJwt(token);
    expect(payload.iss).toBeUndefined();
    expect(payload.sub).toBe('user');
    expect(payload.aud).toBe('appstoreconnect-v1');
  });

  it('treats a null issuer_id as an individual key', async () => {
    const token = await createAscApiTokenAsync({
      issuer_id: null,
      key_id: 'D383SF739',
      key: keyPem,
    });

    const payload = jose.decodeJwt(token);
    expect(payload.iss).toBeUndefined();
    expect(payload.sub).toBe('user');
  });

  it('rejects a key without key_id', async () => {
    await expect(createAscApiTokenAsync({ key: keyPem })).rejects.toThrow();
  });
});

describe(isClosedVersionTrainError, () => {
  it('returns true when all errors are closed-version-train codes', () => {
    expect(
      isClosedVersionTrainError([
        { code: '90062' },
        { code: '90186' },
        { code: '90478' },
        { code: '90062' },
      ])
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

describe(isSdkVersionIssueError, () => {
  it('returns true when all errors are SDK-version-issue codes', () => {
    expect(isSdkVersionIssueError([{ code: '90725' }, { code: '90725' }])).toBe(true);
  });

  it('returns false when any other error code is present', () => {
    expect(isSdkVersionIssueError([{ code: '90725' }, { code: '90062' }])).toBe(false);
  });

  it('returns false when there are no errors', () => {
    expect(isSdkVersionIssueError([])).toBe(false);
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
