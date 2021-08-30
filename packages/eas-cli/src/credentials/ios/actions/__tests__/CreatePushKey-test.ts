import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { getAppstoreMock, testAuthCtx } from '../../../__tests__/fixtures-appstore';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { CreatePushKey } from '../CreatePushKey';

jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

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
    expect((ctx.ios.createPushKeyAsync as any).mock.calls.length).toBe(1);
    // expect push key to be created on apple portal
    expect((ctx.appStore.createPushKeyAsync as any).mock.calls.length).toBe(1);
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
