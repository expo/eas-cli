import { findApplicationTarget } from '../../../../project/ios/target.js';
import { confirmAsync } from '../../../../prompts.js';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { testTargets } from '../../../__tests__/fixtures-ios.js';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils.js';
import { CreatePushKey } from '../CreatePushKey.js';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);

describe(CreatePushKey, () => {
  it('creates a Push Key in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      appStore: {
        ...getAppstoreMock(),
        ensureAuthenticatedAsync: jest.fn(() => testAuthCtx),
        authCtx: testAuthCtx,
      },
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const createPushKeyAction = new CreatePushKey(appLookupParams.account);
    await createPushKeyAction.runAsync(ctx);

    // expect push key to be created on expo servers
    expect(jest.mocked(ctx.ios.createPushKeyAsync).mock.calls.length).toBe(1);
    // expect push key to be created on apple portal
    expect(jest.mocked(ctx.appStore.createPushKeyAsync).mock.calls.length).toBe(1);
  });
  it('errors in Non Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const createPushKeyAction = new CreatePushKey(appLookupParams.account);
    await expect(createPushKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
