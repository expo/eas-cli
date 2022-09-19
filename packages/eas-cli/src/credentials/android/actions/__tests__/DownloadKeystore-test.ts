import fs from 'fs-extra';

import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { testAndroidBuildCredentialsFragment } from '../../../__tests__/fixtures-android';
import { testAppQueryByIdResponse } from '../../../__tests__/fixtures-constants';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils';
import { DownloadKeystore } from '../DownloadKeystore';

jest.mock('fs-extra');
jest.mock('../../../../graphql/queries/AppQuery');

describe(DownloadKeystore, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });
  it('downloads a keystore', async () => {
    const fsWriteFileSpy = jest.spyOn(fs, 'writeFile');
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const downloadKeystoreAction = new DownloadKeystore({ app: appLookupParams });
    await downloadKeystoreAction.runAsync(ctx, testAndroidBuildCredentialsFragment);
    expect(fsWriteFileSpy).toHaveBeenCalledTimes(1);
    expect(fsWriteFileSpy).toHaveBeenCalledWith(
      `@${appLookupParams.account.name}__${appLookupParams.projectName}.jks`,
      testAndroidBuildCredentialsFragment.androidKeystore?.keystore,
      'base64'
    );
    fsWriteFileSpy.mockRestore();
  });
  it('works in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const downloadKeystoreAction = new DownloadKeystore({ app: appLookupParams });
    await expect(
      downloadKeystoreAction.runAsync(ctx, testAndroidBuildCredentialsFragment)
    ).resolves.not.toThrowError();
  });
});
