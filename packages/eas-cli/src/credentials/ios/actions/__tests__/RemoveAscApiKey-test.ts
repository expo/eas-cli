import { asMock } from '../../../../__tests__/utils';
import { findApplicationTarget } from '../../../../project/ios/target';
import { confirmAsync } from '../../../../prompts';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testAscApiKeyFragment, testTargets } from '../../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { RemoveAscApiKey } from '../RemoveAscApiKey';

jest.mock('../../../../prompts');
asMock(confirmAsync).mockImplementation(() => true);

describe(RemoveAscApiKey, () => {
  it('removes an Asc Api Key', async () => {
    const ctx = createCtxMock({ nonInteractive: false });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const removeAscApiKeyAction = new RemoveAscApiKey(
      appLookupParams.account,
      testAscApiKeyFragment
    );
    await removeAscApiKeyAction.runAsync(ctx);
    expect(ctx.ios.deleteAscApiKeyAsync).toHaveBeenCalledTimes(1);
    expect(ctx.appStore.revokeAscApiKeyAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx, findApplicationTarget(testTargets));
    const removeAscApiKeyAction = new RemoveAscApiKey(
      appLookupParams.account,
      testAscApiKeyFragment
    );
    await expect(removeAscApiKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
