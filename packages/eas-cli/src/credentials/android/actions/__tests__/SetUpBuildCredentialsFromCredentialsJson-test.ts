import { vol } from 'memfs';

import { AndroidKeystoreType } from '../../../../graphql/generated.js';
import { confirmAsync } from '../../../../prompts.js';
import {
  getNewAndroidApiMock,
  testAndroidBuildCredentialsFragment,
  testJksAndroidKeystoreFragment,
} from '../../../__tests__/fixtures-android.js';
import { createCtxMock } from '../../../__tests__/fixtures-context.js';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
} from '../../../manager/SelectAndroidBuildCredentials.js';
import { AppLookupParams } from '../../api/GraphqlClient.js';
import { getAppLookupParamsFromContextAsync } from '../BuildCredentialsUtils.js';
import { SetUpBuildCredentialsFromCredentialsJson } from '../SetUpBuildCredentialsFromCredentialsJson.js';

jest.mock('fs');

jest.mock('../../../../prompts');
jest.mocked(confirmAsync).mockImplementation(async () => true);
jest.mock('../../../manager/SelectAndroidBuildCredentials');

beforeEach(() => {
  vol.reset();
});

describe(SetUpBuildCredentialsFromCredentialsJson, () => {
  it('sets up a new build configuration from credentials.json upon user request', async () => {
    jest.mocked(SelectAndroidBuildCredentials).mockImplementation((() => {
      return {
        runAsync: () => {
          return {
            resultType: SelectAndroidBuildCredentialsResultType.CREATE_REQUEST,
            result: { isDefault: true, name: 'test configuration' },
          };
        },
      };
    }) as any as (app: AppLookupParams) => SelectAndroidBuildCredentials);
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetUpBuildCredentialsFromCredentialsJson(
      appLookupParams
    );
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore to be created with credentials.json content
    expect(ctx.android.createKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.createKeystoreAsync).toBeCalledWith(appLookupParams.account, {
      keystorePassword: testJksAndroidKeystoreFragment.keystorePassword,
      keyAlias: testJksAndroidKeystoreFragment.keyAlias,
      keyPassword: testJksAndroidKeystoreFragment.keyPassword,
      keystore: Buffer.from('some-binary-content').toString('base64'),
      type: AndroidKeystoreType.Unknown,
    });

    // expect new build credentials to be created
    expect(ctx.android.createAndroidAppBuildCredentialsAsync).toHaveBeenCalledTimes(1);
  });
  it('uses an existing build configuration upon user request', async () => {
    jest.mocked(SelectAndroidBuildCredentials).mockImplementation((() => {
      return {
        runAsync: () => {
          return {
            resultType: SelectAndroidBuildCredentialsResultType.EXISTING_CREDENTIALS,
            result: testAndroidBuildCredentialsFragment,
          };
        },
      };
    }) as any as (app: AppLookupParams) => SelectAndroidBuildCredentials);
    const ctx = createCtxMock({
      nonInteractive: false,
      android: {
        ...getNewAndroidApiMock(),
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
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetUpBuildCredentialsFromCredentialsJson(
      appLookupParams
    );
    await setupBuildCredentialsAction.runAsync(ctx);

    // expect keystore to be created with credentials.json content
    expect(ctx.android.createKeystoreAsync).toHaveBeenCalledTimes(1);
    expect(ctx.android.createKeystoreAsync).toBeCalledWith(appLookupParams.account, {
      keystorePassword: testJksAndroidKeystoreFragment.keystorePassword,
      keyAlias: testJksAndroidKeystoreFragment.keyAlias,
      keyPassword: testJksAndroidKeystoreFragment.keyPassword,
      keystore: Buffer.from('some-binary-content').toString('base64'),
      type: AndroidKeystoreType.Unknown,
    });

    // expect existing build credentials to be updated
    expect(ctx.android.updateAndroidAppBuildCredentialsAsync).toHaveBeenCalledTimes(1);
  });
  it('errors in Non-Interactive Mode', async () => {
    const ctx = createCtxMock({
      nonInteractive: true,
    });
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
    const setupBuildCredentialsAction = new SetUpBuildCredentialsFromCredentialsJson(
      appLookupParams
    );
    await expect(setupBuildCredentialsAction.runAsync(ctx)).rejects.toThrowError();
  });
});
