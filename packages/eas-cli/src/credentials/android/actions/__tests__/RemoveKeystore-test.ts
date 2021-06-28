import { confirmAsync } from '../../../../prompts';
import { testAndroidBuildCredentialsFragment } from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { RemoveKeystore } from '../RemoveKeystore';

jest.mock('fs-extra');
jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);

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
describe(RemoveKeystore, () => {
  it('removes a keystore', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const removeKeystoreAction = new RemoveKeystore(appLookupParams);
    await removeKeystoreAction.runAsync(ctx, testAndroidBuildCredentialsFragment);
    expect(ctx.android.deleteKeystoreAsync as any).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({ nonInteractive: true });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const removeKeystoreAction = new RemoveKeystore(appLookupParams);
    await expect(
      removeKeystoreAction.runAsync(ctx, testAndroidBuildCredentialsFragment)
    ).rejects.toThrowError();
  });
});
