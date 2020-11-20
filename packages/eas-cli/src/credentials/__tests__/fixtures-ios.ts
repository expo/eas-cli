import {
  DistributionCertificate,
  DistributionCertificateStoreInfo,
  ProvisioningProfile,
  ProvisioningProfileStoreInfo,
  PushKey,
  PushKeyStoreInfo,
} from '../ios/appstore/Credentials.types';
import { IosDistCredentials, IosPushCredentials } from '../ios/credentials';
import { testProvisioningProfileBase64 } from './fixtures-base64-data';
import { testBundleIdentifier, testExperienceName } from './fixtures-constants';

const today = new Date();
const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

export const testAppleTeam = {
  id: 'test-team-id',
};
export const testProvisioningProfile: ProvisioningProfile = {
  provisioningProfileId: 'test-id',
  provisioningProfile: testProvisioningProfileBase64,
  teamId: 'id',
};
export const testProvisioningProfiles = [testProvisioningProfile];
export const testProvisioningProfileFromApple: ProvisioningProfileStoreInfo = {
  name: 'test-name',
  status: 'Active',
  expires: tomorrow.getTime(),
  distributionMethod: 'test',
  certificates: [],
  provisioningProfileId: testProvisioningProfile.provisioningProfileId,
  provisioningProfile: testProvisioningProfile.provisioningProfile,
  teamId: 'id',
};
export const testProvisioningProfilesFromApple = [testProvisioningProfileFromApple];

export const testDistCert: DistributionCertificate = {
  certP12: 'Y2VydHAxMg==',
  certPassword: 'test-password',
  distCertSerialNumber: 'test-serial',
  teamId: 'test-team-id',
};
export const testIosDistCredential: IosDistCredentials = {
  id: 1,
  type: 'dist-cert',
  ...testDistCert,
};
export const testIosDistCredentials = [testIosDistCredential];
export const testDistCertFromApple: DistributionCertificateStoreInfo = {
  id: 'test-id',
  name: 'test-name',
  status: 'Active',
  created: today.getTime(),
  expires: tomorrow.getTime(),
  ownerName: 'test-owner',
  ownerId: 'test-id',
  serialNumber: testIosDistCredential.distCertSerialNumber as string,
};
export const testDistCertsFromApple = [testDistCertFromApple];

export const testPushKey: PushKey = {
  apnsKeyP8: 'test-p8',
  apnsKeyId: 'test-key-id',
  teamId: 'test-team-id',
};

export const testIosPushCredential: IosPushCredentials = {
  id: 2,
  type: 'push-key',
  ...testPushKey,
};
export const testIosPushCredentials = [testIosPushCredential];
export const testPushKeyFromApple: PushKeyStoreInfo = {
  id: testIosPushCredential.apnsKeyId,
  name: 'test-name',
};
export const testPushKeysFromApple = [testPushKeyFromApple];
export const testLegacyPushCert = {
  pushId: 'test-push-id',
  pushP12: 'test-push-p12',
  pushPassword: 'test-push-password',
};
export const testAppCredential = {
  experienceName: testExperienceName,
  bundleIdentifier: testBundleIdentifier,
  distCredentialsId: testIosDistCredential.id,
  pushCredentialsId: testIosPushCredential.id,
  credentials: {
    ...testProvisioningProfile,
  },
};
export const testAllCredentialsForApp = {
  ...testAppCredential,
  pushCredentials: testPushKey,
  distCredentials: testDistCert,
};
export const testAppCredentials = [testAppCredential];
export const testAllCredentials = {
  userCredentials: [...testIosDistCredentials, ...testIosPushCredentials],
  appCredentials: testAppCredentials,
};

export function getIosApiMock() {
  return {
    getAllCredentials: jest.fn(() => testAllCredentials),
    getDistributionCertificateAsync: jest.fn(() => testIosDistCredential),
    getDistributionCertificateByIdAsync: jest.fn(id =>
      id === testIosDistCredential.id ? testIosDistCredential : null
    ),
    createDistributionCertificateAsync: jest.fn((owner, cert) => ({
      id: 123,
      type: 'dist-cert',
      ...cert,
    })),
    updateDistributionCertificateAsync: jest.fn(),
    deleteDistributionCertificateAsync: jest.fn(),
    useDistributionCertificateAsync: jest.fn(),
    getPushKey: jest.fn(() => testIosPushCredential),
    createPushKeyAsync: jest.fn((owner, key) => ({ id: 124, type: 'push-key', ...key })),
    updatePushKeyAsync: jest.fn(),
    deletePushKeyAsync: jest.fn(),
    usePushKeyAsync: jest.fn(),

    getAppCredentialsAsync: jest.fn(() => testAppCredentials),
    getProvisioningProfileAsync: jest.fn(() => testProvisioningProfile),
    updateProvisioningProfileAsync: jest.fn(),
    deleteProvisioningProfileAsync: jest.fn(),
  };
}

export function getIosApiMockWithoutCredentials() {
  return {
    getAllCredentials: jest.fn(() => ({ appCredentials: [], userCredentials: [] })),
    getDistributionCertificateAsync: jest.fn(() => null),
    getDistributionCertificateByIdAsync: jest.fn(() => {
      throw new Error('not found');
    }),
    createDistributionCertificateAsync: jest.fn(),
    updateDistributionCertificateAsync: jest.fn(),
    deleteDistributionCertificateAsync: jest.fn(),
    useDistributionCertificateAsync: jest.fn(),
    getPushKeyAsync: jest.fn(() => null),
    createPushKeyAsync: jest.fn(),
    updatePushKeyAsync: jest.fn(),
    deletePushKeyAsync: jest.fn(),
    usePushKeyAsync: jest.fn(),
    getAppCredentialsAsync: jest.fn(app => ({
      experienceName: `${app.accountName}/${app.projectName}`,
      bundleIdentifier: app.bundleIdentifier,
    })),
    getProvisioningProfileAsync: jest.fn(() => null),
    updateProvisioningProfileAsync: jest.fn(),
    deleteProvisioningProfileAsync: jest.fn(),
  };
}
