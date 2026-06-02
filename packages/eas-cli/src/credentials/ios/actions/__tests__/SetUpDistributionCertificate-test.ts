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

function createExpiredCert(
  overrides: Partial<AppleDistributionCertificateFragment> = {}
): AppleDistributionCertificateFragment {
  const now = Date.now();
  return createValidCert({
    validityNotBefore: new Date(now - 86_400_000 * 365),
    validityNotAfter: new Date(now - 86_400_000),
    ...overrides,
  });
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

describe('SetUpDistributionCertificate best-effort distribution certificate setup', () => {
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

  function setUpBestEffortCtx(
    options: { authenticated?: boolean; freezeCredentials?: boolean } = {}
  ) {
    const { authenticated = true } = options;
    const validCert = createValidCert();
    const ctx = createCtxMock({
      nonInteractive: true,
      freezeCredentials: options.freezeCredentials,
      appStore: {
        authCtx: authenticated ? testAuthCtx : undefined,
        listDistributionCertificatesAsync: jest
          .fn()
          .mockResolvedValue(mockApplePortalCert(validCert.serialNumber)),
      },
    });
    ctx.appStore.ensureAuthenticatedAsync = jest.fn(async () => {
      ctx.appStore.authCtx = testAuthCtx;
      return testAuthCtx;
    });
    ctx.ios.getDistributionCertificateForAppAsync = jest.fn().mockResolvedValue(validCert);
    ctx.ios.getDistributionCertificatesForAccountAsync = jest.fn().mockResolvedValue([validCert]);
    return { ctx, validCert };
  }

  it('errors when no distribution certificate is configured', async () => {
    const { ctx } = setUpBestEffortCtx({ authenticated: false });
    ctx.ios.getDistributionCertificateForAppAsync = jest.fn().mockResolvedValue(null);

    await expect(setUpDistributionCertificate.runAsync(ctx)).rejects.toThrow(
      'Credentials are not set up'
    );
    expect(CreateDistributionCertificate).not.toHaveBeenCalled();
  });

  it('uses existing valid distribution certificate', async () => {
    const { ctx, validCert } = setUpBestEffortCtx();

    const result = await setUpDistributionCertificate.runAsync(ctx);

    expect(result).toBe(validCert);
    expect(CreateDistributionCertificate).not.toHaveBeenCalled();
  });

  it('reuses a valid distribution certificate from Apple when the current one is invalid', async () => {
    const { ctx } = setUpBestEffortCtx();
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
    const { ctx } = setUpBestEffortCtx();
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

  it('continues with a locally valid certificate when no App Store Connect API key is available', async () => {
    const { ctx, validCert } = setUpBestEffortCtx({ authenticated: false });

    const result = await setUpDistributionCertificate.runAsync(ctx);

    expect(result).toBe(validCert);
    expect(CreateDistributionCertificate).not.toHaveBeenCalled();
  });

  it('propagates Apple validation errors', async () => {
    const { ctx } = setUpBestEffortCtx();
    ctx.appStore.listDistributionCertificatesAsync = jest
      .fn()
      .mockRejectedValue(new Error('Apple API unavailable'));

    await expect(setUpDistributionCertificate.runAsync(ctx)).rejects.toThrow(
      'Apple API unavailable'
    );
    expect(CreateDistributionCertificate).not.toHaveBeenCalled();
  });

  it('blocks repair when credentials are frozen', async () => {
    const { ctx } = setUpBestEffortCtx({ freezeCredentials: true });
    const invalidCurrentCert = createValidCert({ serialNumber: 'invalid-serial' });
    ctx.ios.getDistributionCertificateForAppAsync = jest.fn().mockResolvedValue(invalidCurrentCert);
    ctx.appStore.listDistributionCertificatesAsync = jest
      .fn()
      .mockResolvedValue(mockApplePortalCert('valid-serial'));

    await expect(setUpDistributionCertificate.runAsync(ctx)).rejects.toThrow(
      'Distribution certificate is not configured correctly. Remove the --freeze-credentials flag to configure it.'
    );
    expect(CreateDistributionCertificate).not.toHaveBeenCalled();
  });

  it('errors when repair is required but App Store Connect authentication is unavailable', async () => {
    const { ctx } = setUpBestEffortCtx({ authenticated: false });
    ctx.ios.getDistributionCertificateForAppAsync = jest
      .fn()
      .mockResolvedValue(createExpiredCert());

    await expect(setUpDistributionCertificate.runAsync(ctx)).rejects.toThrow(
      'Authentication with an ASC API key is required to validate and refresh a distribution certificate in non-interactive mode.'
    );
    expect(CreateDistributionCertificate).not.toHaveBeenCalled();
  });

  describe('tryAuthenticateAppStoreWithEasAscApiKeyAsync', () => {
    it('authenticates with ASC environment variables when present', async () => {
      const { ctx } = setUpBestEffortCtx({ authenticated: false });
      jest.mocked(hasAscEnvVars).mockReturnValue(true);

      await setUpDistributionCertificate.runAsync(ctx);

      expect(ctx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith({
        mode: AuthenticationMode.API_KEY,
        teamType: AppleTeamType.COMPANY_OR_ORGANIZATION,
      });
      expect(getAscApiKeyForAppSubmissionsAsync).not.toHaveBeenCalled();
    });

    it('authenticates with the stored submissions ASC API key when env vars are absent', async () => {
      const { ctx } = setUpBestEffortCtx({ authenticated: false });
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

    it('skips authentication when already authenticated', async () => {
      const { ctx } = setUpBestEffortCtx();

      await setUpDistributionCertificate.runAsync(ctx);

      expect(ctx.appStore.ensureAuthenticatedAsync).not.toHaveBeenCalled();
    });
  });
});
