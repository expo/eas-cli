import { UserRole } from '@expo/apple-utils';
import fs from 'fs-extra';

import { promptAsync, selectAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testAscApiKey } from '../../../__tests__/fixtures-ios';
import {
  getCredentialsFromUserAsync,
  shouldAutoGenerateCredentialsAsync,
} from '../../../utils/promptForCredentials';
import {
  AppStoreApiKeyPurpose,
  filterOutIndividualAscApiKeys,
  getAscApiKeyName,
  promptForAscApiKeyPathAsync,
  provideOrGenerateAscApiKeyAsync,
} from '../AscApiKeyUtils';

jest.mock('../../../../prompts');
jest.mock('../../../utils/promptForCredentials');
jest.mock('fs-extra');

function enumKeys<O extends object, K extends keyof O = keyof O>(obj: O): K[] {
  return Object.keys(obj) as K[];
}

afterEach(() => {
  jest.mocked(promptAsync).mockClear();
  jest.mocked(selectAsync).mockClear();
  jest.mocked(getCredentialsFromUserAsync).mockClear();
  jest.mocked(shouldAutoGenerateCredentialsAsync).mockClear();
  jest.mocked(fs.readFile).mockClear();
});

describe(filterOutIndividualAscApiKeys, () => {
  it('removes keys without an issuer identifier and keeps the rest', () => {
    const teamKey = { id: 'team', issuerIdentifier: 'issuer-id' } as any;
    const individualKey = { id: 'individual', issuerIdentifier: null } as any;

    expect(filterOutIndividualAscApiKeys([teamKey, individualKey])).toEqual([teamKey]);
  });

  it('returns all keys when none is individual', () => {
    const keys = [
      { id: 'a', issuerIdentifier: 'issuer-a' },
      { id: 'b', issuerIdentifier: 'issuer-b' },
    ] as any[];

    expect(filterOutIndividualAscApiKeys(keys)).toEqual(keys);
  });
});

describe(getAscApiKeyName, () => {
  // Apple enforces a 30 char limit on this name
  it('produces a name under 30 chars', async () => {
    for (const value of enumKeys(AppStoreApiKeyPurpose)) {
      const purpose = AppStoreApiKeyPurpose[value];
      const name = getAscApiKeyName(purpose);
      expect(name.length < 30).toBe(true);
    }
  });
});

describe(promptForAscApiKeyPathAsync, () => {
  it('prompts for keyId, keyP8Path and issuerId when user is not authenticated to Apple', async () => {
    jest.mocked(selectAsync).mockResolvedValueOnce(false); // team key
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      keyP8Path: '/asc-api-key.p8',
    }));
    jest.mocked(getCredentialsFromUserAsync).mockImplementation(async () => ({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id',
    }));
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => {
          throw new Error('this should not be called');
        }),
        authCtx: null,
      },
    });
    const ascApiKeyPath = await promptForAscApiKeyPathAsync(
      ctx,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    expect(ascApiKeyPath).toEqual({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id',
      keyP8Path: '/asc-api-key.p8',
    });
    expect(selectAsync).toHaveBeenCalledTimes(1); // key type
    expect(promptAsync).toHaveBeenCalledTimes(1); // keyP8Path
    expect(getCredentialsFromUserAsync).toHaveBeenCalledTimes(2); // keyId, issuerId
  });
  it('prompts for keyId, keyP8Path and detects issuerId when user is authenticated to Apple', async () => {
    jest.mocked(selectAsync).mockResolvedValueOnce(false); // team key
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      keyP8Path: '/asc-api-key.p8',
    }));
    jest.mocked(getCredentialsFromUserAsync).mockImplementation(async () => ({
      keyId: 'test-key-id',
    }));
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        getAscApiKeyAsync: jest.fn(() => testAscApiKey),
      },
    });
    const ascApiKeyPath = await promptForAscApiKeyPathAsync(
      ctx,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    expect(ascApiKeyPath).toEqual({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id-from-apple',
      keyP8Path: '/asc-api-key.p8',
    });
    expect(promptAsync).toHaveBeenCalledTimes(1); // keyP8Path
    expect(getCredentialsFromUserAsync).toHaveBeenCalledTimes(1); // keyId
    expect(jest.mocked(ctx.appStore.getAscApiKeyAsync).mock.calls.length).toBe(1); // issuerId
  });
  it('skips the issuer prompt for an individual key in the submission flow', async () => {
    jest.mocked(selectAsync).mockResolvedValueOnce(true); // individual key
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      keyP8Path: '/asc-api-key.p8',
    }));
    jest.mocked(getCredentialsFromUserAsync).mockImplementation(async () => ({
      keyId: 'test-key-id',
    }));
    const getAscApiKeyAsync = jest.fn(() => testAscApiKey);
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        authCtx: testAuthCtx,
        getAscApiKeyAsync,
      },
    });
    const ascApiKeyPath = await promptForAscApiKeyPathAsync(
      ctx,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    expect(ascApiKeyPath).toEqual({
      keyId: 'test-key-id',
      keyP8Path: '/asc-api-key.p8',
    });
    expect(getCredentialsFromUserAsync).toHaveBeenCalledTimes(1); // keyId only
    expect(getAscApiKeyAsync).not.toHaveBeenCalled(); // no issuer detection
  });
  it('does not ask the key type outside the submission flow', async () => {
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      keyP8Path: '/asc-api-key.p8',
    }));
    jest.mocked(getCredentialsFromUserAsync).mockImplementation(async () => ({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id',
    }));
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        authCtx: null,
      },
    });
    const ascApiKeyPath = await promptForAscApiKeyPathAsync(
      ctx,
      AppStoreApiKeyPurpose.ASC_APP_CONNECTION
    );
    expect(ascApiKeyPath).toEqual({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id',
      keyP8Path: '/asc-api-key.p8',
    });
    expect(selectAsync).not.toHaveBeenCalled();
  });
});

describe(provideOrGenerateAscApiKeyAsync, () => {
  it('creates a key with ADMIN role by default', async () => {
    jest.mocked(shouldAutoGenerateCredentialsAsync).mockResolvedValue(true);
    jest.mocked(selectAsync).mockResolvedValue(UserRole.ADMIN);

    const createAscApiKeyAsync = jest.fn(async () => testAscApiKey);
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        authCtx: testAuthCtx,
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        createAscApiKeyAsync,
      },
    });

    await provideOrGenerateAscApiKeyAsync(ctx, AppStoreApiKeyPurpose.ASC_APP_CONNECTION);

    expect(createAscApiKeyAsync).toHaveBeenCalledWith(ctx.analytics, {
      nickname: expect.any(String),
      roles: [UserRole.ADMIN],
    });
  });

  it('allows creating a key with APP_MANAGER role', async () => {
    jest.mocked(shouldAutoGenerateCredentialsAsync).mockResolvedValue(true);
    jest.mocked(selectAsync).mockResolvedValue(UserRole.APP_MANAGER);

    const createAscApiKeyAsync = jest.fn(async () => testAscApiKey);
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        authCtx: testAuthCtx,
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        createAscApiKeyAsync,
      },
    });

    await provideOrGenerateAscApiKeyAsync(ctx, AppStoreApiKeyPurpose.ASC_APP_CONNECTION);

    expect(createAscApiKeyAsync).toHaveBeenCalledWith(ctx.analytics, {
      nickname: expect.any(String),
      roles: [UserRole.APP_MANAGER],
    });
  });

  it('does not apply role override when using a user-provided key', async () => {
    jest.mocked(shouldAutoGenerateCredentialsAsync).mockResolvedValue(false);
    jest.mocked(promptAsync).mockResolvedValue({ keyP8Path: '/asc-api-key.p8' });
    jest.mocked(fs.readFile).mockImplementation(async () => 'test-key-p8' as any);
    jest
      .mocked(getCredentialsFromUserAsync)
      .mockResolvedValueOnce({ keyId: 'test-key-id' })
      .mockResolvedValueOnce({ issuerId: 'test-issuer-id' });

    const createAscApiKeyAsync = jest.fn(async () => testAscApiKey);
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        authCtx: null,
        createAscApiKeyAsync,
      },
    });

    const result = await provideOrGenerateAscApiKeyAsync(
      ctx,
      AppStoreApiKeyPurpose.ASC_APP_CONNECTION
    );

    expect(result).toEqual({
      keyP8: expect.any(String),
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id',
    });
    expect(selectAsync).not.toHaveBeenCalled();
    expect(createAscApiKeyAsync).not.toHaveBeenCalled();
  });
});
