import { AndroidCredentials } from '../android/credentials';
import { testKeystore2Base64, testKeystoreBase64 } from './fixtures-base64-data';
import { testExperienceName, testJester2ExperienceName } from './fixtures-constants';

export const testKeystore = {
  keystore: testKeystoreBase64,
  keystorePassword: 'ae6777e9444a436dbe533d2be46c83ba',
  keyAlias: 'QHdrb3p5cmEvY3JlZGVudGlhbHMtdGVzdA==',
  keyPassword: '43f760fe7ecd4e6a925779eb45bc787b',
};
export const testKeystore2 = {
  keystore: testKeystore2Base64,
  keystorePassword: '6faeed2326b94effadbeb731510c2378',
  keyAlias: 'QHdrb3p5cmEvY3JlZGVudGlhbHMtdGVzdA==',
  keyPassword: 'e4829b38057042d78f25053f390478f9',
};

export const testPushCredentials = {
  fcmApiKey: 'examplefcmapikey',
};

export const testAppCredentials = {
  experienceName: testExperienceName,
  keystore: testKeystore,
  pushCredentials: testPushCredentials,
};

export const testJester2AppCredentials = {
  experienceName: testJester2ExperienceName,
  keystore: testKeystore2,
  pushCredentials: testPushCredentials,
};

export const testAllCredentials: { [key: string]: AndroidCredentials } = {
  [testExperienceName]: testAppCredentials,
};

export function getApiClientWrapperMock() {
  // by default all method throw exceptions to make sure that we only call what is expected
  const getUnexpectedCallMock = () =>
    jest.fn(() => {
      throw new Error('unexpected call');
    });
  return {
    getAllCredentialsApi: getUnexpectedCallMock(),
    getAllCredentialsForAppApi: getUnexpectedCallMock(),
    updateKeystoreApi: getUnexpectedCallMock(),
    updateFcmKeyApi: getUnexpectedCallMock(),
    removeKeystoreApi: getUnexpectedCallMock(),
    removeFcmKeyApi: getUnexpectedCallMock(),
  };
}

export function getAndroidApiMock() {
  return {
    fetchAllAsync: jest.fn(() => testAllCredentials),
    fetchKeystoreAsync: jest.fn(() => testKeystore),
    updateKeystoreAsync: jest.fn(),
    removeKeystoreAsync: jest.fn(),
  };
}

export function getAndroidApiMockWithoutCredentials() {
  return {
    fetchAllAsync: jest.fn(() => []),
    fetchKeystoreAsync: jest.fn(() => null),
    updateKeystoreAsync: jest.fn(),
    removeKeystoreAsync: jest.fn(),
  };
}
