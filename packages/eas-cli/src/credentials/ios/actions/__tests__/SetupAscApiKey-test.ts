import { asMock } from '../../../../__tests__/utils';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync, promptAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testAscApiKey,
  testAscApiKeyFragment,
  testCommonIosAppCredentialsFragment,
  testTargets,
} from '../../../__tests__/fixtures-ios';
import { AppStoreApiKeyPurpose } from '../AscApiKeyUtils';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { SetupAscApiKey, USE_EXISTING } from '../SetupAscApiKey';

jest.mock('../../../../prompts');
asMock(confirmAsync).mockImplementation(() => true);

describe(SetupAscApiKey, () => {
  it('skips setting up a App Store Connect Api Key if it is already configured', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      ios: {
        ...getNewIosApiMock(),
        getIosAppCredentialsWithCommonFieldsAsync: jest.fn(
          () => testCommonIosAppCredentialsFragment
        ),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupAscApiKeyAction = new SetupAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await setupAscApiKeyAction.runAsync(ctx);

    // expect not to create a new App Store Connect Api Key on expo servers
    expect(asMock(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(0);
    // expect configuration not to be updated with a new App Store Connect Api Key
    expect(asMock(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(0);
  });
  it('sets up a App Store Connect Api Key, creating a new one if there are no existing App Store Connect Api Keys', async () => {
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
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupAscApiKeyAction = new SetupAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await setupAscApiKeyAction.runAsync(ctx);

    // expect to create a new App Store Connect Api Key on expo servers
    expect(asMock(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(1);
    // expect configuration to be updated with a new App Store Connect Api Key
    expect(asMock(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('sets up a App Store Connect Api Key, use autoselected App Store Connect Api Key when there are existing keys', async () => {
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
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupAscApiKeyAction = new SetupAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await setupAscApiKeyAction.runAsync(ctx);

    // expect not to create a new App Store Connect Api Key on expo servers, we are using the existing one
    expect(asMock(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(0);
    // expect configuration to be updated with a new App Store Connect Api Key
    expect(asMock(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('sets up a App Store Connect Api Key, allowing user to choose existing keys', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      ios: {
        ...getNewIosApiMock(),
        getAscApiKeysForAccountAsync: jest.fn(() => [testAscApiKeyFragment]),
      },
    });
    asMock(promptAsync).mockImplementation(() => ({
      choice: USE_EXISTING,
      chosenAscApiKey: testAscApiKeyFragment,
    }));
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupAscApiKeyAction = new SetupAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await setupAscApiKeyAction.runAsync(ctx);

    // expect not to create a new App Store Connect Api Key on expo servers, we are using the existing one
    expect(asMock(ctx.ios.createAscApiKeyAsync).mock.calls.length).toBe(0);
    // expect configuration to be updated with a new App Store Connect Api Key
    expect(asMock(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const createAscApiKeyAction = new SetupAscApiKey(
      appLookupParams,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );
    await expect(createAscApiKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
