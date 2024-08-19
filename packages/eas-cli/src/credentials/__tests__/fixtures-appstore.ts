import AppStoreApi from '../ios/appstore/AppStoreApi';
import { AuthCtx, AuthenticationMode } from '../ios/appstore/authenticateTypes';

export const testAuthCtx: AuthCtx = {
  appleId: 'test-apple-id',
  appleIdPassword: 'test-apple-password',
  team: { id: 'test-apple-team-identifier', name: 'test-team-name', inHouse: false },
};

export function getAppstoreMock(): AppStoreApi {
  return {
    defaultAuthenticationMode: AuthenticationMode.USER,
    ensureAuthenticatedAsync: jest.fn(),
    ensureBundleIdExistsAsync: jest.fn(),
    listDistributionCertificatesAsync: jest.fn(),
    createDistributionCertificateAsync: jest.fn(),
    revokeDistributionCertificateAsync: jest.fn(),
    listPushKeysAsync: jest.fn(),
    createPushKeyAsync: jest.fn(),
    revokePushKeyAsync: jest.fn(),
    useExistingProvisioningProfileAsync: jest.fn(),
    listProvisioningProfilesAsync: jest.fn(),
    createProvisioningProfileAsync: jest.fn(),
    revokeProvisioningProfileAsync: jest.fn(),
    createOrReuseAdhocProvisioningProfileAsync: jest.fn(),
    createAscApiKeyAsync: jest.fn(),
    getAscApiKeyAsync: jest.fn(),
    revokeAscApiKeyAsync: jest.fn(),
    listAscApiKeysAsync: jest.fn(),
  } as any;
}
