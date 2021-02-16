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
