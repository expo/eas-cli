import {
  AndroidAppBuildCredentialsFragment,
  AndroidFcmFragment,
  AndroidFcmVersion,
  AndroidKeystoreFragment,
  AndroidKeystoreType,
  AppFragment,
  CommonAndroidAppCredentialsFragment,
} from '../../graphql/generated';
import { testKeystore } from './fixtures-android';
import { testKeystoreBase64 } from './fixtures-base64-data';

export const testAppFragment: AppFragment = {
  id: 'test-app-id',
  fullName: '@testuser/testapp',
  slug: 'testapp',
};

export const testLegacyAndroidFcmFragment: AndroidFcmFragment = {
  id: 'test-id',
  snippet: {
    firstFourCharacters: 'abcd',
    lastFourCharacters: 'efgh',
  },
  credential: 'abcdxxxxxxefgh',
  version: AndroidFcmVersion.Legacy,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const testJksAndroidKeystoreFragment: AndroidKeystoreFragment = {
  id: 'test-id',
  type: AndroidKeystoreType.Jks,
  keystore: testKeystoreBase64,
  keystorePassword: testKeystore.keystorePassword,
  keyAlias: testKeystore.keyAlias,
  keyPassword: testKeystore.keyPassword,
  md5CertificateFingerprint: 'test-md5',
  sha1CertificateFingerprint: 'test-sha1',
  sha256CertificateFingerprint: 'test-sha256',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const testLegacyAndroidBuildCredentialsFragment: AndroidAppBuildCredentialsFragment = {
  id: 'test-id',
  isDefault: true,
  isLegacy: true,
  name: 'legacy',
  androidKeystore: testJksAndroidKeystoreFragment,
};

export const testLegacyAndroidAppCredentialsFragment: CommonAndroidAppCredentialsFragment = {
  id: 'test-id',
  applicationIdentifier: null,
  isLegacy: true,
  app: testAppFragment,
  androidAppBuildCredentialsList: [testLegacyAndroidBuildCredentialsFragment],
};

export const testAndroidBuildCredentialsFragment: AndroidAppBuildCredentialsFragment = {
  id: 'test-id',
  isDefault: true,
  isLegacy: false,
  name: 'Google App Store Build Credentials',
  androidKeystore: testJksAndroidKeystoreFragment,
};

export const testAndroidAppCredentialsFragment: CommonAndroidAppCredentialsFragment = {
  id: 'test-id',
  applicationIdentifier: null,
  isLegacy: false,
  app: testAppFragment,
  androidFcm: testLegacyAndroidFcmFragment,
  androidAppBuildCredentialsList: [testLegacyAndroidBuildCredentialsFragment],
};

export function getNewAndroidApiMockWithoutCredentials() {
  return {
    getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(),
    getAndroidAppBuildCredentialsListAsync: jest.fn(() => []),
    getLegacyAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(),
    getLegacyAndroidAppBuildCredentialsAsync: jest.fn(),
    createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync: jest.fn(),
    updateAndroidAppCredentialsAsync: jest.fn(),
    updateAndroidAppBuildCredentialsAsync: jest.fn(),
    createAndroidAppBuildCredentialsAsync: jest.fn(),
    getDefaultAndroidAppBuildCredentialsAsync: jest.fn(),
    getAndroidAppBuildCredentialsByNameAsync: jest.fn(),
    createOrUpdateAndroidAppBuildCredentialsByNameAsync: jest.fn(),
    createKeystoreAsync: jest.fn(),
    createFcmAsync: jest.fn(),
  };
}
