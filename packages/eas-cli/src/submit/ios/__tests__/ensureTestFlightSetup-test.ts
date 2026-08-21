import { App } from '@expo/apple-utils';
import { Platform } from '@expo/eas-build-job';

import { resolveAscApiKeyForAppCredentialsAsync } from '../../../credentials/ios/actions/AscApiKeyUtils';
import { AuthenticationMode } from '../../../credentials/ios/appstore/authenticateTypes';
import { ensureTestFlightGroupExistsAsync } from '../../../credentials/ios/appstore/ensureTestFlightGroup';
import { hasAscEnvVars } from '../../../credentials/ios/appstore/resolveCredentials';
import { SubmissionContext } from '../../context';
import { ensureTestFlightSetupForExistingAppAsync } from '../ensureTestFlightSetup';

jest.mock('@expo/apple-utils', () => ({
  ...jest.requireActual('@expo/apple-utils'),
  App: { infoAsync: jest.fn() },
}));
jest.mock('../../../credentials/ios/actions/AscApiKeyUtils', () => ({
  resolveAscApiKeyForAppCredentialsAsync: jest.fn(),
}));
jest.mock('../../../credentials/ios/appstore/ensureTestFlightGroup', () => ({
  ensureTestFlightGroupExistsAsync: jest.fn(),
}));
jest.mock('../../../credentials/ios/appstore/resolveCredentials', () => ({
  ...jest.requireActual('../../../credentials/ios/appstore/resolveCredentials'),
  hasAscEnvVars: jest.fn(),
}));

function createContext({
  nonInteractive = false,
  autoTestFlightSetup = true,
}: {
  nonInteractive?: boolean;
  autoTestFlightSetup?: boolean;
}): {
  ctx: SubmissionContext<Platform.IOS>;
  ensureAuthenticatedAsync: jest.Mock;
} {
  const authCtx = {
    team: { id: 'team-id' },
    ascApiKey: { keyP8: 'key', keyId: 'key-id', issuerId: 'issuer-id' },
    authState: { context: {} },
  };
  const appStore: any = { authCtx: undefined };
  const ensureAuthenticatedAsync = jest.fn(async () => {
    appStore.authCtx = authCtx;
    return authCtx;
  });
  appStore.ensureAuthenticatedAsync = ensureAuthenticatedAsync;

  return {
    ctx: {
      nonInteractive,
      autoTestFlightSetup,
      applicationIdentifierOverride: 'com.example.app',
      profile: {},
      user: { accounts: [{ name: 'account' }] },
      accountName: 'account',
      projectName: 'project',
      credentialsCtx: { appStore },
      graphqlClient: {},
    } as SubmissionContext<Platform.IOS>,
    ensureAuthenticatedAsync,
  };
}

describe(ensureTestFlightSetupForExistingAppAsync, () => {
  beforeEach(() => {
    delete process.env.EXPO_ASC_API_KEY_PATH;
    delete process.env.EXPO_ASC_KEY_ID;
    delete process.env.EXPO_ASC_ISSUER_ID;
    delete process.env.EXPO_APPLE_TEAM_ID;
    jest.mocked(hasAscEnvVars).mockReset().mockReturnValue(false);
    jest.mocked(resolveAscApiKeyForAppCredentialsAsync).mockReset().mockResolvedValue(null);
    jest
      .mocked(App.infoAsync)
      .mockReset()
      .mockResolvedValue({ id: '12345678' } as App);
    jest.mocked(ensureTestFlightGroupExistsAsync).mockReset();
  });

  it('sets up TestFlight in non-interactive mode when stored credentials are complete', async () => {
    jest.mocked(resolveAscApiKeyForAppCredentialsAsync).mockResolvedValue({
      ascApiKey: { keyP8: 'key', keyId: 'key-id', issuerId: 'issuer-id' },
      teamId: 'team-id',
      teamName: 'Team',
    });
    const { ctx, ensureAuthenticatedAsync } = createContext({ nonInteractive: true });

    await ensureTestFlightSetupForExistingAppAsync(ctx, '12345678');

    expect(ensureAuthenticatedAsync).toHaveBeenCalledWith({
      mode: AuthenticationMode.API_KEY,
      allowIndividualAscApiKey: true,
      ascApiKey: { keyP8: 'key', keyId: 'key-id', issuerId: 'issuer-id' },
      teamId: 'team-id',
      teamName: 'Team',
      teamType: expect.any(String),
    });
    expect(ensureTestFlightGroupExistsAsync).toHaveBeenCalledWith(expect.anything(), {
      nonInteractive: true,
    });
  });

  it('sets up TestFlight in non-interactive mode when environment credentials are complete', async () => {
    jest.mocked(hasAscEnvVars).mockReturnValue(true);
    process.env.EXPO_ASC_API_KEY_PATH = '/path/to/key.p8';
    process.env.EXPO_ASC_KEY_ID = 'key-id';
    process.env.EXPO_ASC_ISSUER_ID = 'issuer-id';
    process.env.EXPO_APPLE_TEAM_ID = 'team-id';
    const { ctx, ensureAuthenticatedAsync } = createContext({ nonInteractive: true });

    await ensureTestFlightSetupForExistingAppAsync(ctx, '12345678');

    expect(ensureAuthenticatedAsync).toHaveBeenCalledWith({
      mode: AuthenticationMode.API_KEY,
      allowIndividualAscApiKey: true,
      teamId: 'team-id',
      teamType: expect.any(String),
    });
    expect(ensureTestFlightGroupExistsAsync).toHaveBeenCalledWith(expect.anything(), {
      nonInteractive: true,
    });
  });

  it('sets up TestFlight when environment credentials have no issuer ID (individual key)', async () => {
    jest.mocked(hasAscEnvVars).mockReturnValue(true);
    process.env.EXPO_ASC_API_KEY_PATH = '/path/to/key.p8';
    process.env.EXPO_ASC_KEY_ID = 'key-id';
    process.env.EXPO_APPLE_TEAM_ID = 'team-id';
    const { ctx, ensureAuthenticatedAsync } = createContext({ nonInteractive: true });

    await ensureTestFlightSetupForExistingAppAsync(ctx, '12345678');

    expect(ensureAuthenticatedAsync).toHaveBeenCalledWith({
      mode: AuthenticationMode.API_KEY,
      allowIndividualAscApiKey: true,
      teamId: 'team-id',
      teamType: expect.any(String),
    });
    expect(ensureTestFlightGroupExistsAsync).toHaveBeenCalledWith(expect.anything(), {
      nonInteractive: true,
    });
  });

  it('skips setup when environment credentials are incomplete', async () => {
    jest.mocked(hasAscEnvVars).mockReturnValue(true);
    process.env.EXPO_ASC_KEY_ID = 'key-id';
    const { ctx, ensureAuthenticatedAsync } = createContext({ nonInteractive: true });

    await ensureTestFlightSetupForExistingAppAsync(ctx, '12345678');

    expect(ensureAuthenticatedAsync).not.toHaveBeenCalled();
    expect(resolveAscApiKeyForAppCredentialsAsync).not.toHaveBeenCalled();
    expect(ensureTestFlightGroupExistsAsync).not.toHaveBeenCalled();
  });

  it('skips setup when stored credentials have no Apple Team ID', async () => {
    jest.mocked(resolveAscApiKeyForAppCredentialsAsync).mockResolvedValue({
      ascApiKey: { keyP8: 'key', keyId: 'key-id', issuerId: 'issuer-id' },
    });
    const { ctx, ensureAuthenticatedAsync } = createContext({ nonInteractive: true });

    await ensureTestFlightSetupForExistingAppAsync(ctx, '12345678');

    expect(ensureAuthenticatedAsync).not.toHaveBeenCalled();
    expect(ensureTestFlightGroupExistsAsync).not.toHaveBeenCalled();
  });

  it('skips setup when automatic setup is disabled', async () => {
    const { ctx, ensureAuthenticatedAsync } = createContext({ autoTestFlightSetup: false });

    await ensureTestFlightSetupForExistingAppAsync(ctx, '12345678');

    expect(ensureAuthenticatedAsync).not.toHaveBeenCalled();
    expect(resolveAscApiKeyForAppCredentialsAsync).not.toHaveBeenCalled();
  });
});
