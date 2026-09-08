import { UserRole } from '@expo/apple-utils';
import fs from 'fs-extra';

import { AppStoreConnectApiKeyQuery } from '../../../../graphql/queries/AppStoreConnectApiKeyQuery';
import Log from '../../../../log';
import { promptAsync, selectAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testAscApiKey } from '../../../__tests__/fixtures-ios';
import {
  getCredentialsFromUserAsync,
  shouldAutoGenerateCredentialsAsync,
} from '../../../utils/promptForCredentials';
import { getAscApiKeyForAppSubmissionsAsync } from '../../api/GraphqlClient';
import { AppleTeamType } from '../../appstore/authenticateTypes';
import { hasAscEnvVars } from '../../appstore/resolveCredentials';
import {
  AppStoreApiKeyPurpose,
  getAscApiKeyName,
  promptForAscApiKeyPathAsync,
  provideOrGenerateAscApiKeyAsync,
  tryAuthenticateAppStoreWithEasAscApiKeyAsync,
} from '../AscApiKeyUtils';

jest.mock('../../../../prompts');
jest.mock('../../../utils/promptForCredentials');
jest.mock('fs-extra');
jest.mock('../../api/GraphqlClient', () => ({
  ...jest.requireActual('../../api/GraphqlClient'),
  getAscApiKeyForAppSubmissionsAsync: jest.fn(),
}));
jest.mock('../../appstore/resolveCredentials', () => ({
  hasAscEnvVars: jest.fn(),
}));
jest.mock('../../../../graphql/queries/AppStoreConnectApiKeyQuery', () => ({
  AppStoreConnectApiKeyQuery: {
    getByIdAsync: jest.fn(),
  },
}));

function enumKeys<O extends object, K extends keyof O = keyof O>(obj: O): K[] {
  return Object.keys(obj) as K[];
}

afterEach(() => {
  jest.mocked(promptAsync).mockClear();
  jest.mocked(selectAsync).mockClear();
  jest.mocked(getCredentialsFromUserAsync).mockClear();
  jest.mocked(shouldAutoGenerateCredentialsAsync).mockClear();
  jest.mocked(fs.readFile).mockClear();
  jest.mocked(hasAscEnvVars).mockReset();
  jest.mocked(getAscApiKeyForAppSubmissionsAsync).mockReset();
  jest.mocked(AppStoreConnectApiKeyQuery.getByIdAsync).mockReset();
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
    const ascApiKeyPath = await promptForAscApiKeyPathAsync(ctx);
    expect(ascApiKeyPath).toEqual({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id',
      keyP8Path: '/asc-api-key.p8',
    });
    expect(promptAsync).toHaveBeenCalledTimes(1); // keyP8Path
    expect(getCredentialsFromUserAsync).toHaveBeenCalledTimes(2); // keyId, issuerId
  });
  it('prompts for keyId, keyP8Path and detects issuerId when user is authenticated to Apple', async () => {
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
    const ascApiKeyPath = await promptForAscApiKeyPathAsync(ctx);
    expect(ascApiKeyPath).toEqual({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id-from-apple',
      keyP8Path: '/asc-api-key.p8',
    });
    expect(promptAsync).toHaveBeenCalledTimes(1); // keyP8Path
    expect(getCredentialsFromUserAsync).toHaveBeenCalledTimes(1); // keyId
    expect(jest.mocked(ctx.appStore.getAscApiKeyAsync).mock.calls.length).toBe(1); // issuerId
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

describe(tryAuthenticateAppStoreWithEasAscApiKeyAsync, () => {
  const app = {
    account: { name: 'test-account' },
    projectName: 'test-project',
    bundleIdentifier: 'com.test.app',
  } as any;

  afterEach(() => {
    delete process.env.EXPO_ASC_API_KEY_PATH;
    delete process.env.EXPO_ASC_KEY_ID;
    delete process.env.EXPO_ASC_ISSUER_ID;
  });

  function createNonInteractiveCtx(): ReturnType<typeof createCtxMock> {
    return createCtxMock({
      nonInteractive: true,
      appStore: {
        ...getAppstoreMock(),
        authCtx: null,
        ensureAuthenticatedAsync: jest.fn(),
      },
    });
  }

  it('skips authentication without a warning when the environment key has no issuer ID', async () => {
    const logWarnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
    process.env.EXPO_ASC_API_KEY_PATH = '/asc-api-key.p8';
    process.env.EXPO_ASC_KEY_ID = 'env-key-id';
    jest.mocked(hasAscEnvVars).mockReturnValue(true);
    const ctx = createNonInteractiveCtx();

    const result = await tryAuthenticateAppStoreWithEasAscApiKeyAsync(
      ctx,
      app,
      AppleTeamType.COMPANY_OR_ORGANIZATION
    );

    expect(result).toBe(false);
    expect(ctx.appStore.ensureAuthenticatedAsync).not.toHaveBeenCalled();
    expect(getAscApiKeyForAppSubmissionsAsync).not.toHaveBeenCalled();
    expect(logWarnSpy).not.toHaveBeenCalled();
    logWarnSpy.mockRestore();
  });

  it('authenticates with the environment key when it has an issuer ID', async () => {
    process.env.EXPO_ASC_API_KEY_PATH = '/asc-api-key.p8';
    process.env.EXPO_ASC_KEY_ID = 'env-key-id';
    process.env.EXPO_ASC_ISSUER_ID = 'env-issuer-id';
    jest.mocked(hasAscEnvVars).mockReturnValue(true);
    const ctx = createNonInteractiveCtx();
    jest.mocked(ctx.appStore.ensureAuthenticatedAsync).mockImplementation(async () => {
      (ctx.appStore as any).authCtx = testAuthCtx;
      return testAuthCtx;
    });

    const result = await tryAuthenticateAppStoreWithEasAscApiKeyAsync(
      ctx,
      app,
      AppleTeamType.COMPANY_OR_ORGANIZATION
    );

    expect(result).toBe(true);
    expect(ctx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledTimes(1);
  });

  it('skips authentication without a warning when the stored submission key has no issuer ID', async () => {
    const logWarnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.mocked(hasAscEnvVars).mockReturnValue(false);
    jest.mocked(getAscApiKeyForAppSubmissionsAsync).mockResolvedValue({
      id: 'asc-key-id',
      appleTeam: { appleTeamIdentifier: 'TEAM123', appleTeamName: 'Team Name' },
    } as any);
    jest.mocked(AppStoreConnectApiKeyQuery.getByIdAsync).mockResolvedValue({
      keyP8: 'key-p8',
      keyIdentifier: 'stored-key-id',
      issuerIdentifier: null,
    } as any);
    const ctx = createNonInteractiveCtx();

    const result = await tryAuthenticateAppStoreWithEasAscApiKeyAsync(
      ctx,
      app,
      AppleTeamType.COMPANY_OR_ORGANIZATION
    );

    expect(result).toBe(false);
    expect(ctx.appStore.ensureAuthenticatedAsync).not.toHaveBeenCalled();
    expect(logWarnSpy).not.toHaveBeenCalled();
    logWarnSpy.mockRestore();
  });
});
