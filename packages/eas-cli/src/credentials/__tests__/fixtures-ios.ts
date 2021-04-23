import {
  AppFragment,
  AppleAppIdentifierFragment,
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../graphql/generated';
import { IosAppCredentialsWithBuildCredentialsQueryResult } from '../ios/api/graphql/queries/IosAppCredentialsQuery';
import {
  DistributionCertificate,
  ProvisioningProfile,
  PushKey,
} from '../ios/appstore/Credentials.types';
import { IosDistCredentials, IosPushCredentials } from '../ios/credentials';
import { testProvisioningProfileBase64 } from './fixtures-base64-data';
import { testBundleIdentifier, testExperienceName } from './fixtures-constants';

export const testProvisioningProfile: ProvisioningProfile = {
  provisioningProfileId: 'test-id',
  provisioningProfile: testProvisioningProfileBase64,
  teamId: 'id',
};

export const testAppleTeamFragment: AppleTeamFragment = {
  id: 'test-apple-team-id-1',
  appleTeamIdentifier: 'test-apple-team-identifier',
};

export const testAppleAppIdentifierFragment: AppleAppIdentifierFragment = {
  id: 'test-apple-app-identifier-id-1',
  bundleIdentifier: 'foo.bar.com',
};

export const testAppFragment: AppFragment = {
  id: 'test-app-id',
  fullName: '@testuser/testapp',
  slug: 'testapp',
};

export const testProvisioningProfileFragment: AppleProvisioningProfileFragment = {
  id: 'test-prov-prof-id-1',
  expiration: new Date(),
  developerPortalIdentifier: 'test-developer-identifier',
  provisioningProfile: testProvisioningProfileBase64,
  updatedAt: new Date(),
  status: 'Active',
  appleTeam: { ...testAppleTeamFragment },
  appleDevices: [],
};

export const testDistCertFragmentNoDependencies: AppleDistributionCertificateFragment = {
  id: 'test-dist-cert-id-1',
  certificateP12: 'Y2VydHAxMg==',
  certificatePassword: 'test-password',
  serialNumber: 'test-serial',
  developerPortalIdentifier: 'test-developer-identifier',
  validityNotAfter: new Date(),
  validityNotBefore: new Date(),
  updatedAt: new Date(),
  appleTeam: { ...testAppleTeamFragment },
  iosAppBuildCredentialsList: [],
};

export const testDistCertFragmentOneDependency: AppleDistributionCertificateFragment = {
  id: 'test-dist-cert-id-1',
  certificateP12: 'Y2VydHAxMg==',
  certificatePassword: 'test-password',
  serialNumber: 'test-serial',
  developerPortalIdentifier: 'test-developer-identifier',
  validityNotAfter: new Date(),
  validityNotBefore: new Date(),
  updatedAt: new Date(),
  appleTeam: { ...testAppleTeamFragment },
  iosAppBuildCredentialsList: [
    {
      id: 'test-build-credentials-id',
      iosAppCredentials: {
        id: 'test-app-credentials-id',
        appleAppIdentifier: { ...testAppleAppIdentifierFragment },
        app: { ...testAppFragment },
      },
      provisioningProfile: {
        id: 'test-provisioning-profile-id',
        developerPortalIdentifier: 'test-developer-identifier',
      },
    },
  ],
};

export const testIosAppBuildCredentialsFragment: IosAppBuildCredentialsFragment = {
  id: 'test-ios-app-build-credentials-id',
  iosDistributionType: IosDistributionType.AppStore,
  distributionCertificate: testDistCertFragmentNoDependencies,
  provisioningProfile: testProvisioningProfileFragment,
};

export const testCommonIosAppCredentialsFragment: CommonIosAppCredentialsFragment = {
  id: 'test-common-ios-app-credentials-id',
  app: testAppFragment,
  appleTeam: testAppleTeamFragment,
  appleAppIdentifier: testAppleAppIdentifierFragment,
  iosAppBuildCredentialsArray: [testIosAppBuildCredentialsFragment],
};

export const testIosAppCredentialsWithBuildCredentialsQueryResult: IosAppCredentialsWithBuildCredentialsQueryResult = {
  id: 'test-app-credential-id',
  iosAppBuildCredentialsArray: [testIosAppBuildCredentialsFragment],
};

export const testAppleTeam = {
  id: 'test-team-id',
};

export function getNewIosApiMockWithoutCredentials() {
  return {
    getAppAsync: jest.fn(),
    createOrUpdateIosAppBuildCredentialsAsync: jest.fn(),
    getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(),
    createOrGetExistingIosAppCredentialsWithBuildCredentialsAsync: jest.fn(),
    createOrGetExistingAppleTeamAsync: () => testAppleTeam,
    createOrGetExistingAppleAppIdentifierAsync: jest.fn(),
    getDevicesForAppleTeamAsync: jest.fn(),
    createProvisioningProfileAsync: jest.fn(),
    getProvisioningProfileAsync: jest.fn(),
    updateProvisioningProfileAsync: jest.fn(),
    deleteProvisioningProfilesAsync: jest.fn(),
    getDistributionCertificateForAppAsync: jest.fn(),
    getDistributionCertificatesForAccountAsync: jest.fn(),
    createDistributionCertificateAsync: jest.fn(),
    deleteDistributionCertificateAsync: jest.fn(),
  };
}

export function getNewIosApiMockWithCredentials() {
  return {
    getAppAsync: jest.fn(),
    createOrUpdateIosAppBuildCredentialsAsync: jest.fn(),
    getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(),
    createOrGetExistingIosAppCredentialsWithBuildCredentialsAsync: jest.fn(),
    createOrGetExistingAppleTeamAsync: jest.fn(),
    createOrGetExistingAppleAppIdentifierAsync: jest.fn(),
    getDevicesForAppleTeamAsync: jest.fn(),
    createProvisioningProfileAsync: jest.fn(),
    getProvisioningProfileAsync: jest.fn(),
    updateProvisioningProfileAsync: jest.fn(),
    deleteProvisioningProfilesAsync: jest.fn(),
    getDistributionCertificateForAppAsync: jest.fn(),
    getDistributionCertificatesForAccountAsync: jest.fn(),
    createDistributionCertificateAsync: jest.fn(),
    deleteDistributionCertificateAsync: jest.fn(),
  };
}

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

export const testPushKey: PushKey = {
  apnsKeyP8: 'test-p8',
  apnsKeyId: 'test-key-id',
  teamId: 'test-team-id',
};

/**
 * Legacy format fixtures
 */

export const testIosPushCredential: IosPushCredentials = {
  id: 2,
  type: 'push-key',
  ...testPushKey,
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
