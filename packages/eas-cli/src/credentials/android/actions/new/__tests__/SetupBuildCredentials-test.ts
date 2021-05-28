import { confirmAsync, promptAsync } from '../../../../../prompts';
import {
  getNewAndroidApiMockWithoutCredentials,
  testAndroidBuildCredentialsFragment,
  testJksAndroidKeystoreFragment,
  testLegacyAndroidBuildCredentialsFragment,
} from '../../../../__tests__/fixtures-android-new';
import { createCtxMock } from '../../../../__tests__/fixtures-context';
import { MissingCredentialsNonInteractiveError } from '../../../../errors';
import { getAppLookupParamsFromContextAsync } from '../../BuildCredentialsUtils';
import { SetupBuildCredentials } from '../SetupBuildCredentials';

jest.mock('../../../../../prompts');
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

describe('SetupBuildCredentials', () => {
  it('skips setup when there are prior legacy credentials', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      newAndroid: {
        ...getNewAndroidApiMockWithoutCredentials(),
        getLegacyAndroidAppBuildCredentialsAsync: jest.fn(
          () => testLegacyAndroidBuildCredentialsFragment
        ),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetupBuildCredentials({ app: appLookupParams });
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore not to be created
    expect(ctx.newAndroid.createKeystoreAsync as any).toHaveBeenCalledTimes(0);
  });
  it('skips setup when there are prior credentials', async () => {
    const ctx = createCtxMock({
      nonInteractive: false,
      newAndroid: {
        ...getNewAndroidApiMockWithoutCredentials(),
        getDefaultAndroidAppBuildCredentialsAsync: jest.fn(
          () => testAndroidBuildCredentialsFragment
        ),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetupBuildCredentials({ app: appLookupParams });
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore not to be created
    expect(ctx.newAndroid.createKeystoreAsync as any).toHaveBeenCalledTimes(0);
  });
  it('sets up credentials when there are no prior credentials', async () => {
    (promptAsync as jest.Mock).mockImplementation(() => ({ providedName: 'test-provided-name' }));
    const ctx = createCtxMock({
      nonInteractive: false,
      newAndroid: {
        ...getNewAndroidApiMockWithoutCredentials(),
        createKeystoreAsync: jest.fn(() => testJksAndroidKeystoreFragment),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetupBuildCredentials({ app: appLookupParams });
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore to be created
    expect(ctx.newAndroid.createKeystoreAsync as any).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    (promptAsync as jest.Mock).mockImplementation(() => ({ providedName: 'test-provided-name' }));
    const ctx = createCtxMock({
      nonInteractive: true,
      newAndroid: {
        ...getNewAndroidApiMockWithoutCredentials(),
      },
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetupBuildCredentials({ app: appLookupParams });
    await expect(setupBuildCredentialsAction.runAsync(ctx)).rejects.toThrowError(
      MissingCredentialsNonInteractiveError
    );
  });
});
