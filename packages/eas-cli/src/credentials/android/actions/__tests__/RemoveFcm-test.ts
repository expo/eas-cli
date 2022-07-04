import { confirmAsync } from '../../../../prompts.js';
import {
  getNewAndroidApiMock,
  testAndroidAppCredentialsFragment,
} from '../../../__tests__/fixtures-android.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils.js';
import { RemoveFcm } from '../RemoveFcm.js';

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);

describe(RemoveFcm, () => {
  it('removes an FCM API Key', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
        getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(
          () => testAndroidAppCredentialsFragment
        ),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const removeFcmApiKeyAction = new RemoveFcm(appLookupParams);
    await removeFcmApiKeyAction.runAsync(ctx);
    expect(ctx.android.deleteFcmAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const removeFcmApiKeyAction = new RemoveFcm(appLookupParams);
    await expect(removeFcmApiKeyAction.runAsync(ctx)).rejects.toThrowError();
  });
});
