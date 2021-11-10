import { findApplicationTarget } from '../../../../project/ios/target';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testAscApiKeyFragment, testTargets } from '../../../__tests__/fixtures-ios';
import { AppStoreApiKeyPurpose } from '../AscApiKeyUtils';
import { AssignAscApiKey } from '../AssignAscApiKey';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';

describe(AssignAscApiKey, () => {
  it('assigns an App Store Connect API Key in Interactive Mode for EAS Submit', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const assignAscApiKeyAction = new AssignAscApiKey(appLookupParams);
    await assignAscApiKeyAction.runAsync(
      ctx,
      testAscApiKeyFragment,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );

    // expect app credentials to be fetched/created, then updated
    expect(ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync).toHaveBeenCalledTimes(1);
    expect(ctx.ios.updateIosAppCredentialsAsync).toHaveBeenCalledTimes(1);
  });
  it('works in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const assignAscApiKeyAction = new AssignAscApiKey(appLookupParams);
    await assignAscApiKeyAction.runAsync(
      ctx,
      testAscApiKeyFragment,
      AppStoreApiKeyPurpose.SUBMISSION_SERVICE
    );

    // dont fail if users are running in non-interactive mode
    await expect(
      assignAscApiKeyAction.runAsync(
        ctx,
        testAscApiKeyFragment,
        AppStoreApiKeyPurpose.SUBMISSION_SERVICE
      )
    ).resolves.not.toThrowError();
  });
});
