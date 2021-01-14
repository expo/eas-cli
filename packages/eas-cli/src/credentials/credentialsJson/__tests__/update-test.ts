import fs from 'fs-extra';
import { vol } from 'memfs';
import prompts from 'prompts';

import { asMock } from '../../../__tests__/utils';
import { testKeystore } from '../../__tests__/fixtures-android';
import { createCtxMock } from '../../__tests__/fixtures-context';
import {
  testAllCredentialsForApp,
  testIosDistCredential,
  testProvisioningProfile,
} from '../../__tests__/fixtures-ios';
import { updateAndroidCredentialsAsync, updateIosCredentialsAsync } from '../update';

jest.mock('fs');
jest.mock('prompts');

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
          getAppCredentialsAsync: jest.fn(() => testAllCredentialsForApp),
          getDistributionCertificateAsync: jest.fn(() => testIosDistCredential),
          getProvisioningProfileAsync: jest.fn(() => testProvisioningProfile),
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
      await updateIosCredentialsAsync(ctx, 'bundleIdentifier');
      const certP12 = await fs.readFile('./cert.p12', 'base64');
      const pprofile = await fs.readFile('./pprofile', 'base64');
      const credJson = await fs.readJson('./credentials.json');
      expect(certP12).toEqual(testAllCredentialsForApp.distCredentials.certP12);
      expect(pprofile).toEqual(testAllCredentialsForApp.credentials.provisioningProfile);
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
          getAppCredentialsAsync: jest.fn(() => testAllCredentialsForApp),
          getDistributionCertificateAsync: jest.fn(() => testIosDistCredential),
          getProvisioningProfileAsync: jest.fn(() => testProvisioningProfile),
        },
      });
      await updateIosCredentialsAsync(ctx, 'bundleIdentifier');
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
          getAppCredentialsAsync: jest.fn(() => null),
          getDistributionCertificateAsync: jest.fn(() => null),
          getProvisioningProfileAsync: jest.fn(() => null),
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
        await updateIosCredentialsAsync(ctx, 'bundleIdentifier');
        throw new Error('updateIosCredentialsAsync should throw na error');
      } catch (e) {
        expect(e.message).toMatch(
          'There are no credentials configured for this project on EAS servers'
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
      const ctx = createCtxMock({
        ios: {
          getAppCredentialsAsync: jest.fn(() => ({
            ...testAllCredentialsForApp,
            distCredentialsId: undefined,
            distCredentials: undefined,
          })),
          getDistributionCertificateAsync: jest.fn(() => null),
          getProvisioningProfileAsync: jest.fn(() => testProvisioningProfile),
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
      await updateIosCredentialsAsync(ctx, 'bundleIdentifier');
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
  });
});
