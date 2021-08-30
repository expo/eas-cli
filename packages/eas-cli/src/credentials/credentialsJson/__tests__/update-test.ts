import fs from 'fs-extra';
import { vol } from 'memfs';
import prompts from 'prompts';

import { asMock } from '../../../__tests__/utils';
import { IosDistributionType } from '../../../graphql/generated';
import {
  testKeystore,
  testLegacyAndroidBuildCredentialsFragment,
} from '../../__tests__/fixtures-android';
import { createCtxMock } from '../../__tests__/fixtures-context';
import {
  getNewIosApiMock,
  testCommonIosAppCredentialsFragment,
  testDistCertFragmentNoDependencies,
  testProvisioningProfileFragment,
} from '../../__tests__/fixtures-ios';
import { getAppFromContext } from '../../ios/actions/BuildCredentialsUtils';
import { Target } from '../../ios/types';
import { updateAndroidCredentialsAsync, updateIosCredentialsAsync } from '../update';

jest.mock('fs');
jest.mock('prompts');

describe('update credentials.json', () => {
  beforeEach(() => {
    vol.reset();
    asMock(prompts).mockReset();
    asMock(prompts).mockImplementation(() => {
      throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
    });
  });

  describe(updateAndroidCredentialsAsync, () => {
    it('should update keystore in credentials.json if www returns valid credentials', async () => {
      const ctx = createCtxMock();
      vol.fromJSON({
        './credentials.json': JSON.stringify({
          android: {
            keystore: {
              keystorePath: 'keystore.jks',
              keystorePassword: 'keystorePassword',
              keyAlias: 'keyAlias',
              keyPassword: 'keyPassword',
            },
          },
        }),
        'keystore.jks': 'somebinarydata',
      });
      await updateAndroidCredentialsAsync(ctx, testLegacyAndroidBuildCredentialsFragment);
      const keystore = await fs.readFile('./keystore.jks', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(keystore).toEqual(testKeystore.keystore);
      expect(credJson).toEqual({
        android: {
          keystore: {
            keystorePath: 'keystore.jks',
            keystorePassword:
              testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keystorePassword,
            keyAlias: testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keyAlias,
            keyPassword: testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keyPassword,
          },
        },
      });
    });
    it('should create credentials.json and keystore if credentials.json does not exist', async () => {
      const ctx = createCtxMock();
      await updateAndroidCredentialsAsync(ctx, testLegacyAndroidBuildCredentialsFragment);
      const keystore = await fs.readFile('./credentials/android/keystore.jks', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(keystore).toEqual(testKeystore.keystore);
      expect(credJson).toEqual({
        android: {
          keystore: {
            keystorePath: 'credentials/android/keystore.jks',
            keystorePassword:
              testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keystorePassword,
            keyAlias: testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keyAlias,
            keyPassword: testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keyPassword,
          },
        },
      });
    });
    it('should not do anything if keystore in www is missing', async () => {
      const ctx = createCtxMock();
      const credJson = {
        android: {
          keystore: {
            keystorePath: 'keystore.jks',
            keystorePassword: 'keystorePassword',
            keyAlias: 'keyAlias',
            keyPassword: 'keyPassword',
          },
        },
      };
      vol.fromJSON({
        './credentials.json': JSON.stringify(credJson),
        'keystore.jks': 'somebinarydata',
      });
      try {
        const buildCredentialsNoKeystore = { ...testLegacyAndroidBuildCredentialsFragment };
        delete buildCredentialsNoKeystore.androidKeystore;
        await updateAndroidCredentialsAsync(ctx, buildCredentialsNoKeystore);
        throw new Error('updateAndroidCredentialsAsync should throw an error');
      } catch (e: any) {
        expect(e.message).toMatch(
          'There are no credentials configured for this project on EAS servers'
        );
      }
      const keystore = await fs.readFile('./keystore.jks', 'base64');
      const newCredJson = await fs.readJson('./credentials.json');
      expect(keystore).toEqual('c29tZWJpbmFyeWRhdGE='); // base64 "somebinarydata"
      expect(newCredJson).toEqual(credJson);
    });
    it('should update keystore and credentials.json if android part of credentials.json is not valid', async () => {
      const ctx = createCtxMock();
      vol.fromJSON({
        './credentials.json': JSON.stringify({ android: { test: '123' } }),
      });
      await updateAndroidCredentialsAsync(ctx, testLegacyAndroidBuildCredentialsFragment);
      const keystore = await fs.readFile('./credentials/android/keystore.jks', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(keystore).toEqual(testKeystore.keystore);
      expect(credJson).toEqual({
        android: {
          keystore: {
            keystorePath: 'credentials/android/keystore.jks',
            keystorePassword:
              testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keystorePassword,
            keyAlias: testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keyAlias,
            keyPassword: testLegacyAndroidBuildCredentialsFragment.androidKeystore?.keyPassword,
          },
        },
      });
    });
    it('should update keystore and credentials.json if ios part of credentials.json is not valid', async () => {
      const ctx = createCtxMock();
      const credJson = {
        android: {
          keystore: {
            keystorePath: 'keystore.jks',
            keystorePassword: 'keystorePassword',
            keyAlias: 'keyAlias',
            keyPassword: 'keyPassword',
          },
        },
        ios: {
          test: '123',
        },
      };
      vol.fromJSON({
        './credentials.json': JSON.stringify(credJson),
        'keystore.jks': 'somebinarydata',
      });
      await updateAndroidCredentialsAsync(ctx, testLegacyAndroidBuildCredentialsFragment);
      const keystore = await fs.readFile('./keystore.jks', 'base64');
      const newCredJson = await fs.readJson('./credentials.json');
      expect(keystore).toEqual(testKeystore.keystore);
      expect(newCredJson).toEqual({
        android: {
          keystore: {
            keystorePath: 'keystore.jks',
            keystorePassword: testKeystore.keystorePassword,
            keyAlias: testKeystore.keyAlias,
            keyPassword: testKeystore.keyPassword,
          },
        },
        ios: {
          test: '123',
        },
      });
    });
  });
  describe(updateIosCredentialsAsync, () => {
    const targets: Target[] = [
      {
        targetName: 'testapp',
        bundleIdentifier: 'com.bundle.id',
      },
    ];

    it('should update ios credentials in credentials.json if www returns valid credentials', async () => {
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMock(),
          getIosAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testCommonIosAppCredentialsFragment
          ),
        },
      });
      vol.fromJSON({
        './credentials.json': JSON.stringify({
          ios: {
            provisioningProfilePath: 'pprofile',
            distributionCertificate: {
              path: 'cert.p12',
              password: 'certPass',
            },
          },
        }),
        './pprofile': 'somebinarycontent',
        './cert.p12': 'somebinarycontent2',
      });
      const app = getAppFromContext(ctx);

      await updateIosCredentialsAsync(ctx, app, targets, IosDistributionType.AppStore);
      const certP12 = await fs.readFile('./cert.p12', 'base64');
      const pprofile = await fs.readFile('./pprofile', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(certP12).toEqual(
        testCommonIosAppCredentialsFragment.iosAppBuildCredentialsList[0].distributionCertificate
          ?.certificateP12
      );
      expect(pprofile).toEqual(
        testCommonIosAppCredentialsFragment.iosAppBuildCredentialsList[0].provisioningProfile
          ?.provisioningProfile
      );
      expect(credJson).toEqual({
        ios: {
          provisioningProfilePath: 'pprofile',
          distributionCertificate: {
            path: 'cert.p12',
            password: testDistCertFragmentNoDependencies.certificatePassword,
          },
        },
      });
    });
    it('should create credentials.json provisioning profile and distribution certificate if credentials.json does not exist', async () => {
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMock(),
          getIosAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testCommonIosAppCredentialsFragment
          ),
        },
      });
      const app = getAppFromContext(ctx);

      await updateIosCredentialsAsync(ctx, app, targets, IosDistributionType.AppStore);

      const certP12 = await fs.readFile('./credentials/ios/dist-cert.p12', 'base64');
      const pprofile = await fs.readFile('./credentials/ios/profile.mobileprovision', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(certP12).toEqual(testDistCertFragmentNoDependencies.certificateP12);
      expect(pprofile).toEqual(testProvisioningProfileFragment.provisioningProfile);
      expect(credJson).toEqual({
        ios: {
          provisioningProfilePath: `credentials/ios/profile.mobileprovision`,
          distributionCertificate: {
            path: `credentials/ios/dist-cert.p12`,
            password: testDistCertFragmentNoDependencies.certificatePassword,
          },
        },
      });
    });
    it('should not do anything if no credentials are returned from www', async () => {
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMock(),
          getIosAppCredentialsWithCommonFieldsAsync: jest.fn(() => null),
        },
      });
      const credJson = {
        ios: {
          provisioningProfilePath: 'pprofile',
          distributionCertificate: {
            path: 'cert.p12',
            password: 'certPass',
          },
        },
      };
      vol.fromJSON({
        './credentials.json': JSON.stringify(credJson),
        './pprofile': 'somebinarycontent',
        './cert.p12': 'somebinarycontent2',
      });
      const app = getAppFromContext(ctx);
      try {
        await updateIosCredentialsAsync(ctx, app, targets, IosDistributionType.AppStore);
        throw new Error('updateIosCredentialsAsync should throw na error');
      } catch (e: any) {
        expect(e.message).toMatch('There are no credentials configured');
      }
      const certP12 = await fs.readFile('./cert.p12', 'base64');
      const pprofile = await fs.readFile('./pprofile', 'base64');
      const newCredJson = await fs.readJson('./credentials.json');
      expect(certP12).toEqual('c29tZWJpbmFyeWNvbnRlbnQy'); // base64 "somebinarycontent2"
      expect(pprofile).toEqual('c29tZWJpbmFyeWNvbnRlbnQ='); // base64 "somebinarycontent"
      expect(newCredJson).toEqual(credJson);
    });
  });
});
