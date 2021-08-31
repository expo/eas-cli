import {
  AppFragment,
  AppleAppIdentifierFragment,
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  ApplePushKeyFragment,
  AppleTeamFragment,
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../graphql/generated';
import { DistributionCertificate, ProvisioningProfile } from '../ios/appstore/Credentials.types';
import { Target } from '../ios/types';
import { testProvisioningProfileBase64 } from './fixtures-base64-data';

const now = new Date();

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

export const testPushKey: ApplePushKeyFragment = {
  id: 'test-push-key-id',
  keyIdentifier: 'test-key-identifier',
  appleTeam: { ...testAppleTeamFragment },
  updatedAt: now,
  iosAppCredentialsList: [],
};

export const testTargets: Target[] = [{ targetName: 'testapp', bundleIdentifier: 'foo.bar.com' }];

export const testProvisioningProfileFragment: AppleProvisioningProfileFragment = {
  id: 'test-prov-prof-id-1',
  expiration: now,
  developerPortalIdentifier: 'test-developer-identifier',
  provisioningProfile: testProvisioningProfileBase64,
  updatedAt: now,
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
  validityNotAfter: now,
  validityNotBefore: now,
  updatedAt: now,
  appleTeam: { ...testAppleTeamFragment },
  iosAppBuildCredentialsList: [],
};

export const testDistCertFragmentOneDependency: AppleDistributionCertificateFragment = {
  id: 'test-dist-cert-id-1',
  certificateP12: 'Y2VydHAxMg==',
  certificatePassword: 'test-password',
  serialNumber: 'test-serial',
  developerPortalIdentifier: 'test-developer-identifier',
  validityNotAfter: now,
  validityNotBefore: now,
  updatedAt: now,
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
  pushKey: testPushKey,
  iosAppBuildCredentialsList: [testIosAppBuildCredentialsFragment],
};

export const testAppleTeam = {
  id: 'test-team-id',
};

export function getNewIosApiMock() {
  return {
    getIosAppCredentialsWithCommonFieldsAsync: jest.fn(),
    createOrGetIosAppCredentialsWithCommonFieldsAsync: jest.fn(),
    updateIosAppCredentialsAsync: jest.fn(),
    createOrUpdateIosAppBuildCredentialsAsync: jest.fn(),
    getIosAppCredentialsWithBuildCredentialsAsync: jest.fn(),
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
    createPushKeyAsync: jest.fn(),
    getPushKeyForAppAsync: jest.fn(),
    deletePushKeyAsync: jest.fn(),
  };
}

export const testDistCert: DistributionCertificate = {
  certP12: 'Y2VydHAxMg==',
  certPassword: 'test-password',
  distCertSerialNumber: 'test-serial',
  teamId: 'test-team-id',
};
