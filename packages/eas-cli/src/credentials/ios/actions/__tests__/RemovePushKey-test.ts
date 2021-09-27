import { asMock } from '../../../../__tests__/utils';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testPushKey, testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { RemovePushKey } from '../RemovePushKey';

jest.mock('../../../../prompts');
asMock(confirmAsync).mockImplementation(() => true);

describe(RemovePushKey, () => {
  it('deletes the push key on Expo and Apple servers in Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const removePushKeyAction = new RemovePushKey(appLookupParams.account, testPushKey);
    await removePushKeyAction.runAsync(ctx);

    // expect push key to be deleted on expo servers
    expect(asMock(ctx.ios.deletePushKeyAsync).mock.calls.length).toBe(1);
    // expect push key to be revoked on apple portal
    expect(asMock(ctx.appStore.revokePushKeyAsync).mock.calls.length).toBe(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const removePushKeyAction = new RemovePushKey(appLookupParams.account, testPushKey);
    await expect(removePushKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
