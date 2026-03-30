import { App } from '@expo/apple-utils';
import { SubmitProfile } from '@expo/eas-json';

import { getAppStoreAuthAsync } from '../auth';
import { AuthenticationMode } from '../../credentials/ios/appstore/authenticateTypes';

// Mock all external dependencies
jest.mock('@expo/apple-utils', () => ({
  App: { findAsync: jest.fn() },
}));

jest.mock('../../credentials/ios/appstore/authenticate', () => ({
  getRequestContext: jest.fn(() => ({ token: 'mock-token' })),
}));

jest.mock('../../credentials/ios/appstore/resolveCredentials', () => ({
  hasAscEnvVars: jest.fn(() => false),
}));

jest.mock('../../project/ios/bundleIdentifier', () => ({
  getBundleIdentifierAsync: jest.fn(() => 'com.example.app'),
}));

jest.mock('../../project/projectUtils', () => ({
  getOwnerAccountForProjectIdAsync: jest.fn(() => ({
    id: 'account-id',
    name: 'testaccount',
  })),
}));

jest.mock('../../credentials/ios/api/GraphqlClient', () => ({
  getAscApiKeyForAppSubmissionsAsync: jest.fn(() => null),
}));

jest.mock('../../graphql/queries/AppStoreConnectApiKeyQuery', () => ({
  AppStoreConnectApiKeyQuery: {
    getByIdAsync: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(() => 'mock-key-p8-content'),
  },
}));

jest.mock('../../log');

const { hasAscEnvVars } =
  require('../../credentials/ios/appstore/resolveCredentials') as jest.Mocked<
    typeof import('../../credentials/ios/appstore/resolveCredentials')
  >;
const { getAscApiKeyForAppSubmissionsAsync } =
  require('../../credentials/ios/api/GraphqlClient') as jest.Mocked<
    typeof import('../../credentials/ios/api/GraphqlClient')
  >;
const { AppStoreConnectApiKeyQuery } =
  require('../../graphql/queries/AppStoreConnectApiKeyQuery') as jest.Mocked<
    typeof import('../../graphql/queries/AppStoreConnectApiKeyQuery')
  >;

const mockApp = { id: '123', bundleId: 'com.example.app' };

function createMockCredentialsCtx(ensureAuthResult?: any) {
  return {
    appStore: {
      ensureAuthenticatedAsync: jest.fn(() => ({
        authState: { context: { token: 'mock-token' } },
        ...ensureAuthResult,
      })),
    },
    vcsClient: {},
  } as any;
}

function createBaseArgs(overrides: Record<string, any> = {}) {
  return {
    projectDir: '/app',
    profile: { bundleIdentifier: 'com.example.app' } as SubmitProfile,
    exp: { slug: 'my-app', name: 'My App' } as any,
    credentialsCtx: createMockCredentialsCtx(),
    nonInteractive: false,
    graphqlClient: {} as any,
    projectId: 'test-project-id',
    ...overrides,
  };
}

describe(getAppStoreAuthAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (App.findAsync as jest.Mock).mockResolvedValue(mockApp);
    hasAscEnvVars.mockReturnValue(false);
    (getAscApiKeyForAppSubmissionsAsync as jest.Mock).mockResolvedValue(null);
  });

  it('uses API key auth when ASC env vars are set', async () => {
    hasAscEnvVars.mockReturnValue(true);
    const args = createBaseArgs();

    const result = await getAppStoreAuthAsync(args);

    expect(args.credentialsCtx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mode: AuthenticationMode.API_KEY })
    );
    expect(result.app).toBe(mockApp);
  });

  it('uses API key from submit profile when ascApiKeyPath/Id/IssuerId are set', async () => {
    const profile = {
      bundleIdentifier: 'com.example.app',
      ascApiKeyPath: '/path/to/key.p8',
      ascApiKeyId: 'KEY123',
      ascApiKeyIssuerId: 'ISSUER456',
    } as any;
    const args = createBaseArgs({ profile });

    const result = await getAppStoreAuthAsync(args);

    expect(args.credentialsCtx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: AuthenticationMode.API_KEY,
        ascApiKey: {
          keyP8: 'mock-key-p8-content',
          keyId: 'KEY123',
          issuerId: 'ISSUER456',
        },
      })
    );
    expect(result.app).toBe(mockApp);
  });

  it('uses API key from EAS credentials service when available', async () => {
    (getAscApiKeyForAppSubmissionsAsync as jest.Mock).mockResolvedValue({
      id: 'asc-key-id',
      keyIdentifier: 'KEY789',
      issuerIdentifier: 'ISSUER012',
      appleTeam: {
        appleTeamIdentifier: 'TEAM123',
        appleTeamName: 'Test Team',
      },
    });
    (AppStoreConnectApiKeyQuery.getByIdAsync as jest.Mock).mockResolvedValue({
      keyP8: 'stored-key-p8',
      keyIdentifier: 'KEY789',
      issuerIdentifier: 'ISSUER012',
    });

    const args = createBaseArgs();
    const result = await getAppStoreAuthAsync(args);

    expect(AppStoreConnectApiKeyQuery.getByIdAsync).toHaveBeenCalledWith(
      args.graphqlClient,
      'asc-key-id'
    );
    expect(args.credentialsCtx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: AuthenticationMode.API_KEY,
        ascApiKey: {
          keyP8: 'stored-key-p8',
          keyId: 'KEY789',
          issuerId: 'ISSUER012',
        },
        teamId: 'TEAM123',
        teamName: 'Test Team',
      })
    );
    expect(result.app).toBe(mockApp);
  });

  it('falls back to interactive cookie auth when no API key and interactive mode', async () => {
    const args = createBaseArgs({ nonInteractive: false });

    const result = await getAppStoreAuthAsync(args);

    // Should call ensureAuthenticatedAsync without API key options
    expect(args.credentialsCtx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith();
    expect(result.app).toBe(mockApp);
  });

  it('throws in non-interactive mode when no API key is available', async () => {
    const args = createBaseArgs({ nonInteractive: true });

    await expect(getAppStoreAuthAsync(args)).rejects.toThrow('No App Store Connect API Key found');
  });

  it('falls back gracefully when credentials service lookup fails', async () => {
    (getAscApiKeyForAppSubmissionsAsync as jest.Mock).mockRejectedValue(new Error('Network error'));

    // Interactive mode: should fall back to cookie auth
    const args = createBaseArgs({ nonInteractive: false });
    const result = await getAppStoreAuthAsync(args);

    expect(args.credentialsCtx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith();
    expect(result.app).toBe(mockApp);
  });

  it('falls back gracefully when credentials service fails in non-interactive mode', async () => {
    (getAscApiKeyForAppSubmissionsAsync as jest.Mock).mockRejectedValue(new Error('Network error'));

    const args = createBaseArgs({ nonInteractive: true });

    await expect(getAppStoreAuthAsync(args)).rejects.toThrow('No App Store Connect API Key found');
  });

  it('prefers submit profile key over credentials service', async () => {
    const profile = {
      bundleIdentifier: 'com.example.app',
      ascApiKeyPath: '/path/to/key.p8',
      ascApiKeyId: 'PROFILE_KEY',
      ascApiKeyIssuerId: 'PROFILE_ISSUER',
    } as any;
    // Also set up a stored key that should NOT be used
    (getAscApiKeyForAppSubmissionsAsync as jest.Mock).mockResolvedValue({
      id: 'stored-key-id',
      keyIdentifier: 'STORED_KEY',
      issuerIdentifier: 'STORED_ISSUER',
    });

    const args = createBaseArgs({ profile });
    await getAppStoreAuthAsync(args);

    // Should use profile key, not the stored one
    expect(args.credentialsCtx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        ascApiKey: expect.objectContaining({ keyId: 'PROFILE_KEY' }),
      })
    );
    // Should NOT have called getByIdAsync since profile key was found first
    expect(AppStoreConnectApiKeyQuery.getByIdAsync).not.toHaveBeenCalled();
  });
});
