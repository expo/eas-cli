import { vol } from 'memfs';

import { findApplicationTarget } from '../../../project/ios/target';
import { testTargets } from '../../__tests__/fixtures-ios';
import * as credentialsJsonReader from '../read';

jest.mock('fs');

beforeEach(() => {
  vol.reset();
});

describe('credentialsJson', () => {
  describe('readAndroidAsync', () => {
    it('should read android credentials if everything is correct', async () => {
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
      const result = await credentialsJsonReader.readAndroidCredentialsAsync('.');
      expect(result).toEqual({
        keystore: {
          keystore: 'c29tZWJpbmFyeWRhdGE=',
          keystorePassword: 'keystorePassword',
          keyAlias: 'keyAlias',
          keyPassword: 'keyPassword',
        },
      });
    });
    it('should throw error when credentials.json is missing', async () => {
      const promise = credentialsJsonReader.readAndroidCredentialsAsync('.');
      await expect(promise).rejects.toThrow(
        'credentials.json does not exist in the project root directory'
      );
    });

    it('should throw error when android entry is missing', async () => {
      vol.fromJSON({
        './credentials.json': JSON.stringify({}),
        'keystore.jks': 'somebinarydata',
      });
      const promise = credentialsJsonReader.readAndroidCredentialsAsync('.');
      await expect(promise).rejects.toThrow('Android credentials are missing in credentials.json');
    });
    it('should throw error when one of the required fields is missing', async () => {
      vol.fromJSON({
        './credentials.json': JSON.stringify({
          android: {
            keystore: {
              keystorePassword: 'keystorePassword',
              keyAlias: 'keyAlias',
              keyPassword: 'keyPassword',
            },
          },
        }),
        'keystore.jks': 'somebinarydata',
      });
      const promise = credentialsJsonReader.readAndroidCredentialsAsync('.');
      await expect(promise).rejects.toThrow(
        'credentials.json is not valid [ValidationError: "android.keystore.keystorePath" is required]'
      );
    });
    it('should throw error when file specified in credentials.json is missing', async () => {
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
      });
      const promise = credentialsJsonReader.readAndroidCredentialsAsync('.');
      await expect(promise).rejects.toThrow(
        "ENOENT: no such file or directory, open 'keystore.jks'"
      );
    });
  });

  describe('readIosAsync', () => {
    describe('single target credentials', () => {
      it('should read ios credentials if everything is correct', async () => {
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
        const applicationTarget = findApplicationTarget(testTargets);
        const result = await credentialsJsonReader.readIosCredentialsAsync('.', applicationTarget);
        expect(result).toEqual({
          [applicationTarget.targetName]: {
            provisioningProfileBase64: 'c29tZWJpbmFyeWNvbnRlbnQ=',
            distributionCertificate: {
              dataBase64: 'c29tZWJpbmFyeWNvbnRlbnQy',
              password: 'certPass',
            },
          },
        });
      });
      it('should throw error when credentials.json is missing', async () => {
        const promise = credentialsJsonReader.readIosCredentialsAsync(
          '.',
          findApplicationTarget(testTargets)
        );
        await expect(promise).rejects.toThrow(
          'credentials.json does not exist in the project root directory'
        );
      });
      it('should throw error if ios field is missing', async () => {
        vol.fromJSON({
          './credentials.json': JSON.stringify({}),
          './pprofile': 'somebinarycontent',
          './cert.p12': 'somebinarycontent2',
        });
        const promise = credentialsJsonReader.readIosCredentialsAsync(
          '.',
          findApplicationTarget(testTargets)
        );
        await expect(promise).rejects.toThrow('iOS credentials are missing in credentials.json');
      });
      it('should throw error if some field is missing', async () => {
        vol.fromJSON({
          './credentials.json': JSON.stringify({
            ios: {
              distributionCertificate: {
                path: 'cert.p12',
                password: 'certPass',
              },
            },
          }),
          './pprofile': 'somebinarycontent',
          './cert.p12': 'somebinarycontent2',
        });
        const promise = credentialsJsonReader.readIosCredentialsAsync(
          '.',
          findApplicationTarget(testTargets)
        );
        await expect(promise).rejects.toThrow(
          'credentials.json is not valid [ValidationError: "ios" does not match any of the allowed types]'
        );
      });
      it('should throw error if dist cert file is missing', async () => {
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
        });
        const promise = credentialsJsonReader.readIosCredentialsAsync(
          '.',
          findApplicationTarget(testTargets)
        );
        await expect(promise).rejects.toThrow("ENOENT: no such file or directory, open 'cert.p12'");
      });
      it('should throw error if provisioningProfile file is missing', async () => {
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
          './cert.p12': 'somebinarycontent2',
        });
        const promise = credentialsJsonReader.readIosCredentialsAsync(
          '.',
          findApplicationTarget(testTargets)
        );
        await expect(promise).rejects.toThrow("ENOENT: no such file or directory, open 'pprofile'");
      });
    });
    describe('multi-target credentials', () => {
      it('should read ios credentials if everything is correct', async () => {
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
        const result = await credentialsJsonReader.readIosCredentialsAsync(
          '.',
          findApplicationTarget(testTargets)
        );
        expect(result).toEqual({
          target1: {
            provisioningProfileBase64: 'cHByb2ZpbGUtMS1zb21lYmluYXJ5Y29udGVudA==',
            distributionCertificate: {
              dataBase64: 'Y2VydC0xLXNvbWViaW5hcnljb250ZW50',
              password: 'cert-pass-1',
            },
          },
          target2: {
            provisioningProfileBase64: 'cHByb2ZpbGUtMi1zb21lYmluYXJ5Y29udGVudA==',
            distributionCertificate: {
              dataBase64: 'Y2VydC0yLXNvbWViaW5hcnljb250ZW50',
              password: 'cert-pass-2',
            },
          },
        });
      });
    });
  });
});
