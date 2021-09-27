import { asMock } from '../../../../__tests__/utils';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getNewIosApiMock, testPushKey, testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { SetupPushKey } from '../SetupPushKey';

jest.mock('../../../../prompts');
asMock(confirmAsync).mockImplementation(() => true);

describe(SetupPushKey, () => {
  it('skips setting up a Push Key if it is already configured', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      ios: {
        ...getNewIosApiMock(),
        getPushKeyForAppAsync: jest.fn(() => testPushKey),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupPushKeyAction = new SetupPushKey(appLookupParams);
    await setupPushKeyAction.runAsync(ctx);

    // expect not to create a new push key on expo servers
    expect(asMock(ctx.ios.createPushKeyAsync).mock.calls.length).toBe(0);
    // expect configuration not to be updated with a new push key
    expect(asMock(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(0);
  });
  it('sets up a Push Key, creating a new one if there are no existing push keys', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      ios: {
        ...getNewIosApiMock(),
        createPushKeyAsync: jest.fn(() => testPushKey),
        getPushKeysForAccountAsync: jest.fn(() => []),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupPushKeyAction = new SetupPushKey(appLookupParams);
    await setupPushKeyAction.runAsync(ctx);

    // expect to create a new push key on expo servers
    expect(asMock(ctx.ios.createPushKeyAsync).mock.calls.length).toBe(1);
    // expect configuration to be updated with a new push key
    expect(asMock(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('sets up a Push Key, use autoselected push key when there are existing keys', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
        listPushKeysAsync: jest.fn(() => [{ id: testPushKey.keyIdentifier }]),
      },
      ios: {
        ...getNewIosApiMock(),
        createPushKeyAsync: jest.fn(() => testPushKey),
        getPushKeysForAccountAsync: jest.fn(() => [testPushKey]),
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const setupPushKeyAction = new SetupPushKey(appLookupParams);
    await setupPushKeyAction.runAsync(ctx);

    // expect not to create a new push key on expo servers, we are using the existing one
    expect(asMock(ctx.ios.createPushKeyAsync).mock.calls.length).toBe(0);
    // expect configuration not to be updated with a new push key
    expect(asMock(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const createPushKeyAction = new SetupPushKey(appLookupParams);
    await expect(createPushKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
