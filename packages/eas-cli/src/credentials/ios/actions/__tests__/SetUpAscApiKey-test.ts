import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync, promptAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testAscApiKey,
  testAscApiKeyFragment,
  testCommonIosAppCredentialsFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { AppStoreApiKeyPurpose } from '../AscApiKeyUtils';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpAscApiKey, SetupAscApiKeyChoice } from '../SetUpAscApiKey';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe(SetUpAscApiKey, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('skips setting up a ASC API Key if it is already configured', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithCommonFieldsAsync: jest.fn(
          () => testCommonIosAppCredentialsFragment
        ),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupAscApiKeyAction = new SetUpAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await setupAscApiKeyAction.runAsync(ctx);

    // expect not to create a new ASC API Key on expo servers
    expect(jest.mocked(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(0);
    // expect configuration not to be updated with a new ASC API Key
    expect(jest.mocked(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(0);
  });
  it('sets up a ASC API Key, creating a new one if there are no existing ASC API Keys', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        createAscApiKeyAsync: jest.fn(() => testAscApiKey),
      },
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithCommonFieldsAsync: jest.fn(),
        createAscApiKeyAsync: jest.fn(() => testAscApiKeyFragment),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupAscApiKeyAction = new SetUpAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await setupAscApiKeyAction.runAsync(ctx);

    // expect to create a new ASC API Key on expo servers
    expect(jest.mocked(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(1);
    // expect configuration to be updated with a new ASC API Key
    expect(jest.mocked(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('sets up a ASC API Key, use autoselected ASC API Key when there are existing keys', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        listAscApiKeysAsync: jest.fn(() => [testAscApiKey]),
      },
      ios: {
        ...getNewIosApiMock(),
        getAscApiKeysForAccountAsync: jest.fn(() => [testAscApiKeyFragment]),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupAscApiKeyAction = new SetUpAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await setupAscApiKeyAction.runAsync(ctx);

    // expect not to create a new ASC API Key on expo servers, we are using the existing one
    expect(jest.mocked(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(0);
    // expect configuration to be updated with a new ASC API Key
    expect(jest.mocked(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('sets up a ASC API Key, allowing user to choose existing keys', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      ios: {
        ...getNewIosApiMock(),
        getAscApiKeysForAccountAsync: jest.fn(() => [testAscApiKeyFragment]),
      },
    });
    jest.mocked(promptAsync).mockImplementation(async () => ({
      choice: SetupAscApiKeyChoice.USE_EXISTING,
      chosenAscApiKey: testAscApiKeyFragment,
    }));
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupAscApiKeyAction = new SetUpAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await setupAscApiKeyAction.runAsync(ctx);

    // expect not to create a new ASC API Key on expo servers, we are using the existing one
    expect(jest.mocked(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(0);
    // expect configuration to be updated with a new ASC API Key
    expect(jest.mocked(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('works in Non Interactive Mode if ASC Key is configured', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithCommonFieldsAsync: jest.fn(
          () => testCommonIosAppCredentialsFragment
        ),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupAscApiKeyAction = new SetUpAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await expect(setupAscApiKeyAction.runAsync(ctx)).resolves.not.toThrowError();
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const createAscApiKeyAction = new SetUpAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await expect(createAscApiKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
