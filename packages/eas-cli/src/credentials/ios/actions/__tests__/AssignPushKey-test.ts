import { findApplicationTarget } from '../../../../project/ios/target.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { testPushKey, testTargets } from '../../../__tests__/fixtures-ios.js';
import { AssignPushKey } from '../AssignPushKey.js';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils.js';

describe(AssignPushKey, () => {
  it('assigns a push key in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const assignPushKeyAction = new AssignPushKey(appLookupParams);
    await assignPushKeyAction.runAsync(ctx, testPushKey);

    // expect app credentials to be fetched/created, then updated
    expect(ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync).toHaveBeenCalledTimes(1);
    expect(ctx.ios.updateIosAppCredentialsAsync).toHaveBeenCalledTimes(1);
  });
  it('works in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const assignPushKeyAction = new AssignPushKey(appLookupParams);
    await assignPushKeyAction.runAsync(ctx, testPushKey);

    // dont fail if users are running in non-interactive mode
    await expect(assignPushKeyAction.runAsync(ctx, testPushKey)).resolves.not.toThrowError();
  });
});
