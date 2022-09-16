import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { confirmAsync } from '../../../../prompts';
import { testAndroidBuildCredentialsFragment } from '../../../__tests__/fixtures-android';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { RemoveKeystore } from '../RemoveKeystore';

jest.mock('fs-extra');
jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../../graphql/queries/AppQuery');

describe(RemoveKeystore, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });

  it('removes a keystore', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const removeKeystoreAction = new RemoveKeystore(appLookupParams);
    await removeKeystoreAction.runAsync(ctx, testAndroidBuildCredentialsFragment);
    expect(ctx.android.deleteKeystoreAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const removeKeystoreAction = new RemoveKeystore(appLookupParams);
    await expect(
      removeKeystoreAction.runAsync(ctx, testAndroidBuildCredentialsFragment)
    ).rejects.toThrowError();
  });
});
