import fs from 'fs-extra';

import { testAndroidBuildCredentialsFragment } from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { DownloadKeystore } from '../DownloadKeystore';

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
});
describe(DownloadKeystore, () => {
  it('downloads a keystore', async () => {
    const fsWriteFileSpy = jest.spyOn(fs, 'writeFile');
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const downloadKeystoreAction = new DownloadKeystore({ app: appLookupParams });
    await downloadKeystoreAction.runAsync(ctx, testAndroidBuildCredentialsFragment);
    expect(fsWriteFileSpy as any).toHaveBeenCalledTimes(1);
    expect(fsWriteFileSpy as any).toHaveBeenCalledWith(
      `@${appLookupParams.account.name}__${appLookupParams.projectName}.jks`,
      testAndroidBuildCredentialsFragment.androidKeystore?.keystore,
      'base64'
    );
    fsWriteFileSpy.mockRestore();
  });
  it('works in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const downloadKeystoreAction = new DownloadKeystore({ app: appLookupParams });
    await expect(
      downloadKeystoreAction.runAsync(ctx, testAndroidBuildCredentialsFragment)
    ).resolves.not.toThrowError();
  });
});
