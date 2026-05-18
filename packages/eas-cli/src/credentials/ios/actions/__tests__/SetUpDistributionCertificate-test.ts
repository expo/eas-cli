import {
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../../graphql/generated';
import { AppStoreConnectApiKeyQuery } from '../../../../graphql/queries/AppStoreConnectApiKeyQuery';
import { createCtxMock } from '../../../__tests__/fixtures-context';
import { testAuthCtx } from '../../../__tests__/fixtures-appstore';
import {
  testAppFragment,
  testAppleTeamFragment,
  testDistCertFragmentNoDependencies,
} from '../../../__tests__/fixtures-ios';
import { getAscApiKeyForAppSubmissionsAsync } from '../../api/GraphqlClient';
import { AppleTeamType, AuthenticationMode } from '../../appstore/authenticateTypes';
import { hasAscEnvVars } from '../../appstore/resolveCredentials';
import { resolveAppleTeamIfAuthenticatedAsync } from '../AppleTeamUtils';
import { CreateDistributionCertificate } from '../CreateDistributionCertificate';
import { SetUpDistributionCertificate } from '../SetUpDistributionCertificate';

jest.mock('../AppleTeamUtils');
jest.mock('../CreateDistributionCertificate');
jest.mock('../../appstore/resolveCredentials', () => ({
  hasAscEnvVars: jest.fn(),
}));
jest.mock('../../api/GraphqlClient', () => ({
  ...jest.requireActual('../../api/GraphqlClient'),
  getAscApiKeyForAppSubmissionsAsync: jest.fn(),
}));
jest.mock('../../../../graphql/queries/AppStoreConnectApiKeyQuery', () => ({
  AppStoreConnectApiKeyQuery: {
    getByIdAsync: jest.fn(),
  },
}));

const app = {
  account: testAppFragment.ownerAccount,
  projectName: 'testproject',
  bundleIdentifier: 'foo.bar.com',
};

function createValidCert(
  overrides: Partial<AppleDistributionCertificateFragment> = {}
): AppleDistributionCertificateFragment {
  const now = Date.now();
  return {
    ...testDistCertFragmentNoDependencies,
    serialNumber: 'valid-serial',
    validityNotBefore: new Date(now - 86_400_000),
    validityNotAfter: new Date(now + 86_400_000 * 365),
    appleTeam: testAppleTeamFragment,
    ...overrides,
  };
}

function mockApplePortalCert(serialNumber: string) {
  return [
    {
      id: 'cert-id',
      name: 'cert',
      status: 'valid',
      created: 0,
      expires: Math.floor(Date.now() / 1000) + 86_400 * 365,
      ownerName: 'owner',
      serialNumber,
    },
  ];
}

describe('SetUpDistributionCertificate refresh distribution certificate', () => {
  let setUpDistributionCertificate: SetUpDistributionCertificate;

  beforeEach(() => {
    jest.clearAllMocks();
    setUpDistributionCertificate = new SetUpDistributionCertificate(
      app,
      IosDistributionType.AppStore
    );
    jest.mocked(resolveAppleTeamIfAuthenticatedAsync).mockResolvedValue(null);
    jest.mocked(hasAscEnvVars).mockReturnValue(false);
    jest.mocked(getAscApiKeyForAppSubmissionsAsync).mockResolvedValue(null);
  });

  function setUpRefreshCtx(options: { authenticated?: boolean } = {}) {
    const { authenticated = true } = options;
    const validCert = createValidCert();
    const ctx = createCtxMock({
      nonInteractive: true,
      refreshDistributionCertificate: true,
      appStore: {
        authCtx: authenticated ? testAuthCtx : undefined,
        ensureAuthenticatedAsync: jest.fn().mockResolvedValue(testAuthCtx),
        listDistributionCertificatesAsync: jest
          .fn()
          .mockResolvedValue(mockApplePortalCert(validCert.serialNumber)),
      },
    });
    ctx.ios.getDistributionCertificateForAppAsync = jest.fn().mockResolvedValue(validCert);
    ctx.ios.getDistributionCertificatesForAccountAsync = jest.fn().mockResolvedValue([validCert]);
    return { ctx, validCert };
  }

  it('uses existing valid distribution certificate in refresh mode', async () => {
    const { ctx, validCert } = setUpRefreshCtx();

    const result = await setUpDistributionCertificate.runAsync(ctx);

    expect(result).toBe(validCert);
    expect(CreateDistributionCertificate).not.toHaveBeenCalled();
  });

  it('reuses a valid distribution certificate from Apple when the current one is invalid', async () => {
    const { ctx } = setUpRefreshCtx();
    const invalidCurrentCert = createValidCert({ serialNumber: 'invalid-serial' });
    const reusableCert = createValidCert({ serialNumber: 'reusable-serial', id: 'reusable-id' });
    ctx.ios.getDistributionCertificateForAppAsync = jest.fn().mockResolvedValue(invalidCurrentCert);
    ctx.appStore.listDistributionCertificatesAsync = jest
      .fn()
      .mockResolvedValue(mockApplePortalCert('reusable-serial'));
    ctx.ios.getDistributionCertificatesForAccountAsync = jest
      .fn()
      .mockResolvedValue([invalidCurrentCert, reusableCert]);

    const result = await setUpDistributionCertificate.runAsync(ctx);

    expect(result).toBe(reusableCert);
    expect(CreateDistributionCertificate).not.toHaveBeenCalled();
  });

  it('creates a new distribution certificate when no valid certificates are available', async () => {
    const { ctx } = setUpRefreshCtx();
    const invalidCurrentCert = createValidCert({ serialNumber: 'invalid-serial' });
    const newCert = createValidCert({ serialNumber: 'new-serial', id: 'new-cert-id' });
    ctx.ios.getDistributionCertificateForAppAsync = jest.fn().mockResolvedValue(invalidCurrentCert);
    ctx.appStore.listDistributionCertificatesAsync = jest.fn().mockResolvedValue([]);
    ctx.ios.getDistributionCertificatesForAccountAsync = jest.fn().mockResolvedValue([]);
    jest.mocked(CreateDistributionCertificate).mockImplementation(
      () =>
        ({
          runAsync: jest.fn().mockResolvedValue(newCert),
        }) as any
    );

    const result = await setUpDistributionCertificate.runAsync(ctx);

    expect(result).toBe(newCert);
    expect(CreateDistributionCertificate).toHaveBeenCalled();
  });

  describe('ensureAppStoreAuthenticatedForDistCertRefreshAsync', () => {
    it('authenticates with ASC environment variables when present', async () => {
      const { ctx } = setUpRefreshCtx({ authenticated: false });
      jest.mocked(hasAscEnvVars).mockReturnValue(true);

      await setUpDistributionCertificate.runAsync(ctx);

      expect(ctx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith({
        mode: AuthenticationMode.API_KEY,
      });
      expect(getAscApiKeyForAppSubmissionsAsync).not.toHaveBeenCalled();
    });

    it('authenticates with the stored submissions ASC API key when env vars are absent', async () => {
      const { ctx } = setUpRefreshCtx({ authenticated: false });
      jest.mocked(hasAscEnvVars).mockReturnValue(false);
      jest.mocked(getAscApiKeyForAppSubmissionsAsync).mockResolvedValue({
        id: 'asc-key-id',
        appleTeam: {
          appleTeamIdentifier: 'TEAM123',
          appleTeamName: 'Team Name',
        },
      } as any);
      jest.mocked(AppStoreConnectApiKeyQuery.getByIdAsync).mockResolvedValue({
        keyP8: 'key-p8',
        keyIdentifier: 'key-id',
        issuerIdentifier: 'issuer-id',
      } as any);

      await setUpDistributionCertificate.runAsync(ctx);

      expect(ctx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith({
        mode: AuthenticationMode.API_KEY,
        ascApiKey: {
          keyP8: 'key-p8',
          keyId: 'key-id',
          issuerId: 'issuer-id',
        },
        teamId: 'TEAM123',
        teamName: 'Team Name',
        teamType: AppleTeamType.COMPANY_OR_ORGANIZATION,
      });
    });

    it('errors when no App Store Connect API key is available', async () => {
      const { ctx } = setUpRefreshCtx({ authenticated: false });

      await expect(setUpDistributionCertificate.runAsync(ctx)).rejects.toThrow(
        'No App Store Connect API Key found for distribution certificate refresh'
      );
    });

    it('skips authentication when already authenticated', async () => {
      const { ctx } = setUpRefreshCtx();

      await setUpDistributionCertificate.runAsync(ctx);

      expect(ctx.appStore.ensureAuthenticatedAsync).not.toHaveBeenCalled();
    });
  });
});
