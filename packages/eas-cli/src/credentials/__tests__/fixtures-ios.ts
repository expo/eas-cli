import { UserRole } from '@expo/apple-utils';

import { testProvisioningProfileBase64 } from './fixtures-base64-data';
import {
  AppFragment,
  AppStoreConnectApiKeyFragment,
  AppStoreConnectUserRole,
  AppleAppIdentifierFragment,
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  ApplePushKeyFragment,
  AppleTeamFragment,
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
  Role,
} from '../../graphql/generated';
import * as IosGraphqlClient from '../ios/api/GraphqlClient';
import {
  AscApiKey,
  DistributionCertificate,
  ProvisioningProfile,
} from '../ios/appstore/Credentials.types';
import { Target } from '../ios/types';

const now = new Date();

export const testAscApiKey: AscApiKey = {
  keyId: 'test-keyIdentifier',
  issuerId: 'test-issuer-id-from-apple',
  teamId: 'test-team-id',
  teamName: 'test-team-name',
  name: 'test-name',
  roles: [UserRole.ADMIN],
  isRevoked: false,
  keyP8: 'test-key-p8',
};

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

export const testAscApiKeyFragment: AppStoreConnectApiKeyFragment = {
  id: 'test-asc-api-key-id',
  appleTeam: { ...testAppleTeamFragment },
  issuerIdentifier: 'test-issuerIdentifier',
  keyIdentifier: 'test-keyIdentifier',
  name: 'test-name',
  roles: [AppStoreConnectUserRole.Admin],
  updatedAt: now,
  createdAt: now,
};

export const testPushKey: ApplePushKeyFragment = {
  id: 'test-push-key-id',
  keyIdentifier: 'test-key-identifier',
  appleTeam: { ...testAppleTeamFragment },
  updatedAt: now,
  iosAppCredentialsList: [],
};

export const testTarget = {
  targetName: 'testapp',
  bundleIdentifier: 'foo.bar.com',
  entitlements: {},
};

export const testTargets: Target[] = [testTarget];

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
  appStoreConnectApiKeyForSubmissions: testAscApiKeyFragment,
};

export const testAppleTeam = {
  id: 'test-team-id',
};

export function getNewIosApiMock(): { [key in keyof typeof IosGraphqlClient]?: any } {
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
    createAscApiKeyAsync: jest.fn(),
    deleteAscApiKeyAsync: jest.fn(),
    getAscApiKeysForAccountAsync: jest.fn(() => []),
  };
}

export const testDistCert: DistributionCertificate = {
  certP12: 'Y2VydHAxMg==',
  certPassword: 'test-password',
  distCertSerialNumber: 'test-serial',
  teamId: 'test-team-id',
};
