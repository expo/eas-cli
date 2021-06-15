import { testLegacyAndroidFcmFragment } from '../../../__tests__/fixtures-android-new';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { AssignFcm } from '../AssignFcm';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';

describe(AssignFcm, () => {
  it('assigns an fcm api key in Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const assignFcmAction = new AssignFcm(appLookupParams);
    await assignFcmAction.runAsync(ctx, testLegacyAndroidFcmFragment);

    // expect app credentials to be fetched/created, then updated
    expect(
      ctx.newAndroid.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync as any
    ).toHaveBeenCalledTimes(1);
    expect(ctx.newAndroid.updateAndroidAppCredentialsAsync as any).toHaveBeenCalledTimes(1);
  });
  it('works in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const assignFcmAction = new AssignFcm(appLookupParams);

    // dont fail if users are running in non-interactive mode
    await expect(
      assignFcmAction.runAsync(ctx, testLegacyAndroidFcmFragment)
    ).resolves.not.toThrowError();
  });
});
