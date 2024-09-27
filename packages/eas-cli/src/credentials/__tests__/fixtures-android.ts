import {
  testKeystore2Base64,
  testKeystoreBase64,
  testPKCS12KeystoreBase64,
  testPKCS12KeystoreEmptyPasswordBase64,
} from './fixtures-base64-data';
import {
  AndroidAppBuildCredentialsFragment,
  AndroidFcmFragment,
  AndroidFcmVersion,
  AndroidKeystoreFragment,
  AndroidKeystoreType,
  AppFragment,
  CommonAndroidAppCredentialsFragment,
  GoogleServiceAccountKeyFragment,
  Role,
} from '../../graphql/generated';
import * as AndroidGraphqlClient from '../android/api/GraphqlClient';
import { Keystore } from '../android/credentials';

const now = new Date();

export const testKeystore: Keystore = {
  keystore: testKeystoreBase64,
  keystorePassword: 'ae6777e9444a436dbe533d2be46c83ba',
  keyAlias: 'QHdrb3p5cmEvY3JlZGVudGlhbHMtdGVzdA==',
  keyPassword: '43f760fe7ecd4e6a925779eb45bc787b',
};
export const testKeystore2: Keystore = {
  keystore: testKeystore2Base64,
  keystorePassword: '6faeed2326b94effadbeb731510c2378',
  keyAlias: 'QHdrb3p5cmEvY3JlZGVudGlhbHMtdGVzdA==',
  keyPassword: 'e4829b38057042d78f25053f390478f9',
};

// Generated by: keytool -genkey -alias test-alias -keystore keystore.p12 -storetype PKCS12 -keyalg RSA -storepass password -validity 730 -keysize 2048
// A Keystore in a PKCS#12 file, where all entries are under aliases
// This particular PKCS#12 has one key and one certificate under 'test-alias'
export const testPKCS12Keystore: Keystore = {
  keystore: testPKCS12KeystoreBase64,
  keystorePassword: 'password',
  keyAlias: 'test-alias',
};

// openssl req -new -newkey rsa:4096 -nodes -keyout test.key -out test.csr
// openssl x509 -req -sha256 -days 365 -in test.csr -signkey test.key -out test.pem
// openssl pkcs12 -export -in test.pem -inkey test.key -name "test-alias" -passout pass: -out emptyPassword.p12
// cat emptyPassword.p12 | base64
export const testPKCS12EmptyPasswordKeystore: Keystore = {
  keystore: testPKCS12KeystoreEmptyPasswordBase64,
  keystorePassword: '',
  keyAlias: 'test-alias',
};

export const testAppFragment: AppFragment = {
  id: 'test-app-id',
  fullName: '@testuser/testapp',
  name: 'testapp',
  slug: 'testapp',
  ownerAccount: {
    id: 'test-account-id',
    name: 'testuser',
    users: [
      {
        role: Role.Owner,
        actor: {
          id: 'test-user-id',
        },
      },
    ],
  },
};

export const testLegacyAndroidFcmFragment: AndroidFcmFragment = {
  id: 'test-id',
  snippet: {
    firstFourCharacters: 'abcd',
    lastFourCharacters: 'efgh',
  },
  credential: 'abcdxxxxxxefgh',
  version: AndroidFcmVersion.Legacy,
  createdAt: now,
  updatedAt: now,
};

export const testGoogleServiceAccountKeyFragment: GoogleServiceAccountKeyFragment = {
  id: 'test-id',
  projectIdentifier: 'sdf.sdf.sdf',
  privateKeyIdentifier: 'test-private-key-identifier',
  clientEmail: 'quin@expo.io',
  clientIdentifier: 'test-client-identifier',
  createdAt: now,
  updatedAt: now,
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
  createdAt: now,
  updatedAt: now,
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
  androidFcm: testLegacyAndroidFcmFragment,
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
  googleServiceAccountKeyForSubmissions: testGoogleServiceAccountKeyFragment,
  androidAppBuildCredentialsList: [testLegacyAndroidBuildCredentialsFragment],
};

export function getNewAndroidApiMock(): { [key in keyof typeof AndroidGraphqlClient]?: any } {
  return {
    getAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(),
    getAndroidAppBuildCredentialsListAsync: jest.fn(() => []),
    getLegacyAndroidAppCredentialsWithCommonFieldsAsync: jest.fn(),
    getLegacyAndroidAppBuildCredentialsAsync: jest.fn(),
    createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync: jest.fn(),
    updateAndroidAppCredentialsAsync: jest.fn(),
    updateAndroidAppBuildCredentialsAsync: jest.fn(),
    createAndroidAppBuildCredentialsAsync: jest.fn(),
    setDefaultAndroidAppBuildCredentialsAsync: jest.fn(),
    getDefaultAndroidAppBuildCredentialsAsync: jest.fn(),
    getAndroidAppBuildCredentialsByNameAsync: jest.fn(),
    createOrUpdateAndroidAppBuildCredentialsByNameAsync: jest.fn(),
    createKeystoreAsync: jest.fn(),
    createGoogleServiceAccountKeyAsync: jest.fn(),
    deleteGoogleServiceAccountKeyAsync: jest.fn(),
    getGoogleServiceAccountKeysForAccountAsync: jest.fn(),
    createFcmAsync: jest.fn(),
    deleteKeystoreAsync: jest.fn(),
    deleteFcmAsync: jest.fn(),
  };
}
