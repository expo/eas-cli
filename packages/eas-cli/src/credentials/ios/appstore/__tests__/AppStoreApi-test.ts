import AppStoreApi from '../AppStoreApi';
import { authenticateAsync } from '../authenticate';
import { AuthCtx } from '../authenticateTypes';
import { listDistributionCertificatesAsync } from '../distributionCertificate';

jest.mock('../authenticate', () => ({
  ...jest.requireActual('../authenticate'),
  authenticateAsync: jest.fn(),
}));
jest.mock('../distributionCertificate');

const individualKeyAuthCtx = {
  ascApiKey: { keyP8: 'p8-content', keyId: 'key-id' },
  team: { id: 'team-id' },
} as AuthCtx;
const teamKeyAuthCtx = {
  ascApiKey: { keyP8: 'p8-content', keyId: 'key-id', issuerId: 'issuer-id' },
  team: { id: 'team-id' },
} as AuthCtx;

beforeEach(() => {
  jest.mocked(authenticateAsync).mockReset();
  jest.mocked(listDistributionCertificatesAsync).mockReset();
});

describe(AppStoreApi, () => {
  it('runs provisioning operations with a team API key', async () => {
    jest.mocked(authenticateAsync).mockResolvedValue(teamKeyAuthCtx);
    jest.mocked(listDistributionCertificatesAsync).mockResolvedValue([]);
    const appStoreApi = new AppStoreApi();

    await expect(appStoreApi.listDistributionCertificatesAsync()).resolves.toEqual([]);
    expect(listDistributionCertificatesAsync).toHaveBeenCalledWith(teamKeyAuthCtx);
  });

  it('rejects provisioning operations with an individual API key before calling Apple', async () => {
    jest.mocked(authenticateAsync).mockResolvedValue(individualKeyAuthCtx);
    const appStoreApi = new AppStoreApi();

    await expect(appStoreApi.listDistributionCertificatesAsync()).rejects.toThrow(
      'individual API key'
    );
    expect(listDistributionCertificatesAsync).not.toHaveBeenCalled();
  });

  it('rejects provisioning operations with an individual API key cached by an earlier flow', async () => {
    jest.mocked(authenticateAsync).mockResolvedValue(individualKeyAuthCtx);
    const appStoreApi = new AppStoreApi();
    await appStoreApi.ensureAuthenticatedAsync();

    await expect(appStoreApi.ensureProvisioningAuthenticatedAsync()).rejects.toThrow(
      'individual API key'
    );
    expect(authenticateAsync).toHaveBeenCalledTimes(1);
  });
});
