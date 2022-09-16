import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getNewIosApiMock, testPushKey, testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { SetUpPushKey } from '../SetUpPushKey';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe(SetUpPushKey, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('skips setting up a Push Key if it is already configured', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      ios: {
        ...getNewIosApiMock(),
        getPushKeyForAppAsync: jest.fn(() => testPushKey),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupPushKeyAction = new SetUpPushKey(appLookupParams);
    await setupPushKeyAction.runAsync(ctx);

    // expect not to create a new push key on expo servers
    expect(jest.mocked(ctx.ios.createPushKeyAsync).mock.calls.length).toBe(0);
    // expect configuration not to be updated with a new push key
    expect(jest.mocked(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(0);
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupPushKeyAction = new SetUpPushKey(appLookupParams);
    await setupPushKeyAction.runAsync(ctx);

    // expect to create a new push key on expo servers
    expect(jest.mocked(ctx.ios.createPushKeyAsync).mock.calls.length).toBe(1);
    // expect configuration to be updated with a new push key
    expect(jest.mocked(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const setupPushKeyAction = new SetUpPushKey(appLookupParams);
    await setupPushKeyAction.runAsync(ctx);

    // expect not to create a new push key on expo servers, we are using the existing one
    expect(jest.mocked(ctx.ios.createPushKeyAsync).mock.calls.length).toBe(0);
    // expect configuration not to be updated with a new push key
    expect(jest.mocked(ctx.ios.updateIosAppCredentialsAsync).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(
      ctx,
      findApplicationTarget(testTargets)
    );
    const createPushKeyAction = new SetUpPushKey(appLookupParams);
    await expect(createPushKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
