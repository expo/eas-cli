import { AuthCtx } from '../ios/appstore/authenticate';

export const testAuthCtx: AuthCtx = {
  appleId: 'test-apple-id',
  appleIdPassword: 'test-apple-password',
  team: { id: 'test-team-id', name: 'test-team-name', inHouse: false },
};

export function getAppstoreMock() {
  return {
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
  };
}
