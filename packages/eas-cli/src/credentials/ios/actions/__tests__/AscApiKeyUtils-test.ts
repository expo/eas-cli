import { promptAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testAscApiKey } from '../../../__tests__/fixtures-ios';
import { getCredentialsFromUserAsync } from '../../../utils/promptForCredentials';
import {
  AppStoreApiKeyPurpose,
  getAscApiKeyName,
  promptForAscApiKeyPathAsync,
} from '../AscApiKeyUtils';

jest.mock('../../../../prompts');
jest.mock('../../../utils/promptForCredentials');

function enumKeys<O extends object, K extends keyof O = keyof O>(obj: O): K[] {
  return Object.keys(obj) as K[];
}

afterEach(() => {
  jest.mocked(promptAsync).mockClear();
  jest.mocked(getCredentialsFromUserAsync).mockClear();
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
