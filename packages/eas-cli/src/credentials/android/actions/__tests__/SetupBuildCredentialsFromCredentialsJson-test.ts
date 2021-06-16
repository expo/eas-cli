import { vol } from 'memfs';

import { AndroidKeystoreType } from '../../../../graphql/generated';
import { confirmAsync } from '../../../../prompts';
import {
  getNewAndroidApiMockWithoutCredentials,
  testAndroidBuildCredentialsFragment,
  testJksAndroidKeystoreFragment,
} from '../../../__tests__/fixtures-android';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
} from '../../../manager/SelectAndroidBuildCredentials';
import { getAppLookupParamsFromContext } from '../BuildCredentialsUtils';
import { SetupBuildCredentialsFromCredentialsJson } from '../SetupBuildCredentialsFromCredentialsJson';

jest.mock('fs');

jest.mock('../../../../prompts');
(confirmAsync as jest.Mock).mockImplementation(() => true);
jest.mock('../../../manager/SelectAndroidBuildCredentials');

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
beforeEach(() => {
  vol.reset();
});

describe(SetupBuildCredentialsFromCredentialsJson, () => {
  it('sets up a new build configuration from credentials.json upon user request', async () => {
    (SelectAndroidBuildCredentials as any).mockImplementation(() => {
      return {
        runAsync: () => {
          return {
            resultType: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
            result: { isDefault: true, name: 'test configuration' },
          };
        },
      };
    });
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMockWithoutCredentials(),
        createKeystoreAsync: jest.fn(() => testJksAndroidKeystoreFragment),
      },
    });
    vol.fromJSON({
      './credentials.json': JSON.stringify({
        android: {
          keystore: {
            keystorePath: 'keystore.jks',
            keystorePassword: testJksAndroidKeystoreFragment.keystorePassword,
            keyAlias: testJksAndroidKeystoreFragment.keyAlias,
            keyPassword: testJksAndroidKeystoreFragment.keyPassword,
          },
        },
      }),
      'keystore.jks': 'some-binary-content',
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const setupBuildCredentialsAction = new SetupBuildCredentialsFromCredentialsJson(
      appLookupParams
    );
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore to be created with credentials.json content
    expect(ctx.android.createKeystoreAsync as any).toHaveBeenCalledTimes(1);
    expect(ctx.android.createKeystoreAsync as any).toBeCalledWith(appLookupParams.account, {
      keystorePassword: testJksAndroidKeystoreFragment.keystorePassword,
      keyAlias: testJksAndroidKeystoreFragment.keyAlias,
      keyPassword: testJksAndroidKeystoreFragment.keyPassword,
      keystore: Buffer.from('some-binary-content').toString('base64'),
      type: AndroidKeystoreType.Unknown,
    });

    // expect new build credentials to be created
    expect(ctx.android.createAndroidAppBuildCredentialsAsync as any).toHaveBeenCalledTimes(1);
  });
  it('uses an existing build configuration upon user request', async () => {
    (SelectAndroidBuildCredentials as any).mockImplementation(() => {
      return {
        runAsync: () => {
          return {
            resultType: SelectAndroidBuildCredentialsResultType.EXISTING_CREDENTIALS,
            result: testAndroidBuildCredentialsFragment,
          };
        },
      };
    });
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMockWithoutCredentials(),
        createKeystoreAsync: jest.fn(() => testJksAndroidKeystoreFragment),
      },
    });
    vol.fromJSON({
      './credentials.json': JSON.stringify({
        android: {
          keystore: {
            keystorePath: 'keystore.jks',
            keystorePassword: testJksAndroidKeystoreFragment.keystorePassword,
            keyAlias: testJksAndroidKeystoreFragment.keyAlias,
            keyPassword: testJksAndroidKeystoreFragment.keyPassword,
          },
        },
      }),
      'keystore.jks': 'some-binary-content',
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const setupBuildCredentialsAction = new SetupBuildCredentialsFromCredentialsJson(
      appLookupParams
    );
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore to be created with credentials.json content
    expect(ctx.android.createKeystoreAsync as any).toHaveBeenCalledTimes(1);
    expect(ctx.android.createKeystoreAsync as any).toBeCalledWith(appLookupParams.account, {
      keystorePassword: testJksAndroidKeystoreFragment.keystorePassword,
      keyAlias: testJksAndroidKeystoreFragment.keyAlias,
      keyPassword: testJksAndroidKeystoreFragment.keyPassword,
      keystore: Buffer.from('some-binary-content').toString('base64'),
      type: AndroidKeystoreType.Unknown,
    });

    // expect existing build credentials to be updated
    expect(ctx.android.updateAndroidAppBuildCredentialsAsync as any).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = getAppLookupParamsFromContext(ctx);
    const setupBuildCredentialsAction = new SetupBuildCredentialsFromCredentialsJson(
      appLookupParams
    );
    await expect(setupBuildCredentialsAction.runAsync(ctx)).rejects.toThrowError();
  });
});
