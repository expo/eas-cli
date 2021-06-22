import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testPushKey, testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { RemovePushKey } from '../RemovePushKey';

jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
});

describe(RemovePushKey, () => {
  it('deletes the push key on Expo and Apple servers in Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const removePushKeyAction = new RemovePushKey(appLookupParams.account, testPushKey);
    await removePushKeyAction.runAsync(ctx);

    // expect push key to be deleted on expo servers
    expect((ctx.ios.deletePushKeyAsync as any).mock.calls.length).toBe(1);
    // expect push key to be revoked on apple portal
    expect((ctx.appStore.revokePushKeyAsync as any).mock.calls.length).toBe(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const removePushKeyAction = new RemovePushKey(appLookupParams.account, testPushKey);
    await expect(removePushKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
