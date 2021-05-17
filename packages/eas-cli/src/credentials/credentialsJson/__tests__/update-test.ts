import fs from 'fs-extra';
import { vol } from 'memfs';
import prompts from 'prompts';

import { asMock } from '../../../__tests__/utils';
import { IosDistributionType } from '../../../graphql/generated';
import { testKeystore } from '../../__tests__/fixtures-android';
import { createCtxMock } from '../../__tests__/fixtures-context';
import {
  getNewIosApiMockWithoutCredentials,
  testAllCredentialsForApp,
  testCommonIosAppCredentialsFragment,
} from '../../__tests__/fixtures-ios';
import { getAppLookupParamsFromContext } from '../../ios/actions/BuildCredentialsUtils';
import { updateAndroidCredentialsAsync, updateIosCredentialsAsync } from '../update';

jest.mock('fs');
jest.mock('prompts');
jest.mock('../../../project/ios/bundleIdentifier');

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

beforeEach(() => {
  vol.reset();
  asMock(prompts).mockReset();
  asMock(prompts).mockImplementation(() => {
    throw new Error(`unhandled prompts call - this shouldn't happen - fix tests!`);
  });
});

describe('update credentials.json', () => {
  describe(updateAndroidCredentialsAsync, () => {
    it('should update keystore in credentials.json if www returns valid credentials', async () => {
      const ctx = createCtxMock({
        android: {
          fetchKeystoreAsync: jest.fn(() => testKeystore),
        },
      });
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
      await updateAndroidCredentialsAsync(ctx);
      const keystore = await fs.readFile('./keystore.jks', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(keystore).toEqual(testKeystore.keystore);
      expect(credJson).toEqual({
        android: {
          keystore: {
            keystorePath: 'keystore.jks',
            keystorePassword: testKeystore.keystorePassword,
            keyAlias: testKeystore.keyAlias,
            keyPassword: testKeystore.keyPassword,
          },
        },
      });
    });
    it('should create credentials.json and keystore if credentials.json does not exist', async () => {
      const ctx = createCtxMock({
        android: {
          fetchKeystoreAsync: jest.fn(() => testKeystore),
        },
      });
      await updateAndroidCredentialsAsync(ctx);
      const keystore = await fs.readFile('./android/keystores/keystore.jks', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(keystore).toEqual(testKeystore.keystore);
      expect(credJson).toEqual({
        android: {
          keystore: {
            keystorePath: 'android/keystores/keystore.jks',
            keystorePassword: testKeystore.keystorePassword,
            keyAlias: testKeystore.keyAlias,
            keyPassword: testKeystore.keyPassword,
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
        await updateAndroidCredentialsAsync(ctx);
        throw new Error('updateAndroidCredentialsAsync should throw an error');
      } catch (e) {
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
      const ctx = createCtxMock({
        android: {
          fetchKeystoreAsync: jest.fn(() => testKeystore),
        },
      });
      vol.fromJSON({
        './credentials.json': JSON.stringify({ android: { test: '123' } }),
      });
      await updateAndroidCredentialsAsync(ctx);
      const keystore = await fs.readFile('./android/keystores/keystore.jks', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(keystore).toEqual(testKeystore.keystore);
      expect(credJson).toEqual({
        android: {
          keystore: {
            keystorePath: 'android/keystores/keystore.jks',
            keystorePassword: testKeystore.keystorePassword,
            keyAlias: testKeystore.keyAlias,
            keyPassword: testKeystore.keyPassword,
          },
        },
      });
    });
    it('should update keystore and credentials.json if ios part of credentials.json is not valid', async () => {
      const ctx = createCtxMock({
        android: {
          fetchKeystoreAsync: jest.fn(() => testKeystore),
        },
      });
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
      await updateAndroidCredentialsAsync(ctx);
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
    it('should update ios credentials in credentials.json if www returns valid credentials', async () => {
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMockWithoutCredentials(),
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
      const appLookupParams = getAppLookupParamsFromContext(ctx);
      await updateIosCredentialsAsync(ctx, appLookupParams, IosDistributionType.AppStore);
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
            password: testAllCredentialsForApp.distCredentials.certPassword,
          },
        },
      });
    });
    it('should create credentials.json provisioning profile and distribution certificate if credentials.json does not exist', async () => {
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMockWithoutCredentials(),
          getIosAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testCommonIosAppCredentialsFragment
          ),
        },
      });
      const appLookupParams = getAppLookupParamsFromContext(ctx);
      await updateIosCredentialsAsync(ctx, appLookupParams, IosDistributionType.AppStore);
      const certP12 = await fs.readFile('./ios/certs/dist-cert.p12', 'base64');
      const pprofile = await fs.readFile('./ios/certs/profile.mobileprovision', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(certP12).toEqual(testAllCredentialsForApp.distCredentials.certP12);
      expect(pprofile).toEqual(testAllCredentialsForApp.credentials.provisioningProfile);
      expect(credJson).toEqual({
        ios: {
          provisioningProfilePath: 'ios/certs/profile.mobileprovision',
          distributionCertificate: {
            path: 'ios/certs/dist-cert.p12',
            password: testAllCredentialsForApp.distCredentials.certPassword,
          },
        },
      });
    });
    it('should not do anything if no credentials are returned from www', async () => {
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMockWithoutCredentials(),
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
      try {
        const appLookupParams = getAppLookupParamsFromContext(ctx);
        await updateIosCredentialsAsync(ctx, appLookupParams, IosDistributionType.AppStore);
        throw new Error('updateIosCredentialsAsync should throw na error');
      } catch (e) {
        expect(e.message).toMatch(
          'There are no credentials configured for the APP_STORE distribution of this project on EAS servers'
        );
      }
      const certP12 = await fs.readFile('./cert.p12', 'base64');
      const pprofile = await fs.readFile('./pprofile', 'base64');
      const newCredJson = await fs.readJson('./credentials.json');
      expect(certP12).toEqual('c29tZWJpbmFyeWNvbnRlbnQy'); // base64 "somebinarycontent2"
      expect(pprofile).toEqual('c29tZWJpbmFyeWNvbnRlbnQ='); // base64 "somebinarycontent"
      expect(newCredJson).toEqual(credJson);
    });
    it('should display confirm prompt if some credentials are missing in www (confirm: true)', async () => {
      // create deep clone the quick and dirty way
      const testIosAppCredentialsNoDistCert = JSON.parse(
        JSON.stringify(testCommonIosAppCredentialsFragment)
      );
      testIosAppCredentialsNoDistCert.iosAppBuildCredentialsList[0].distributionCertificate = null;
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMockWithoutCredentials(),
          getIosAppCredentialsWithCommonFieldsAsync: jest.fn(() => testIosAppCredentialsNoDistCert),
        },
      });

      (prompts as any)
        .mockImplementationOnce(() => ({ value: true })) // Continue with partial credentials
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
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
      const appLookupParams = getAppLookupParamsFromContext(ctx);
      await updateIosCredentialsAsync(ctx, appLookupParams, IosDistributionType.AppStore);
      const certP12Exists = await fs.pathExists('./cert.p12');
      const pprofile = await fs.readFile('./pprofile', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(certP12Exists).toEqual(false);
      expect(pprofile).toEqual(testAllCredentialsForApp.credentials.provisioningProfile);
      expect(credJson).toEqual({
        ios: {
          provisioningProfilePath: 'pprofile',
        },
      });
    });
    it('should throw an error if credentials.json contains credentials for multi-target projects', async () => {
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMockWithoutCredentials(),
          getIosAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testCommonIosAppCredentialsFragment
          ),
        },
      });
      vol.fromJSON({
        './credentials.json': JSON.stringify({
          ios: {
            target1: {
              provisioningProfilePath: 'pprofile-1.mobileprovision',
              distributionCertificate: {
                path: 'dist-cert-1.p12',
                password: 'cert-pass-1',
              },
            },
            target2: {
              provisioningProfilePath: 'pprofile-2.mobileprovision',
              distributionCertificate: {
                path: 'dist-cert-2.p12',
                password: 'cert-pass-2',
              },
            },
          },
        }),
        './pprofile-1.mobileprovision': 'pprofile-1-somebinarycontent',
        './pprofile-2.mobileprovision': 'pprofile-2-somebinarycontent',
        './dist-cert-1.p12': 'cert-1-somebinarycontent',
        './dist-cert-2.p12': 'cert-2-somebinarycontent',
      });
      const appLookupParams = getAppLookupParamsFromContext(ctx);
      await expect(() =>
        updateIosCredentialsAsync(ctx, appLookupParams, IosDistributionType.AppStore)
      ).rejects.toThrow(/Updating credentials.json failed/);
    });
    it(`should throw an error if there is a typo in credentials.json (because we can't tell if this is a target name or not)`, async () => {
      const ctx = createCtxMock({
        ios: {
          ...getNewIosApiMockWithoutCredentials(),
          getIosAppCredentialsWithCommonFieldsAsync: jest.fn(
            () => testCommonIosAppCredentialsFragment
          ),
        },
      });
      vol.fromJSON({
        './credentials.json': JSON.stringify({
          ios: {
            // typo!!!
            xprovisioningProfilePath: 'pprofile-1.mobileprovision',
            distributionCertificate: {
              path: 'dist-cert-1.p12',
              password: 'cert-pass-1',
            },
          },
        }),
        './pprofile-1.mobileprovision': 'pprofile-1-somebinarycontent',
        './dist-cert-1.p12': 'cert-1-somebinarycontent',
      });
      const appLookupParams = getAppLookupParamsFromContext(ctx);
      await expect(() =>
        updateIosCredentialsAsync(ctx, appLookupParams, IosDistributionType.AppStore)
      ).rejects.toThrow(/Updating credentials.json failed/);
    });
  });
});
