import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../../../../commandUtils/errors';
import { selectOrCreateAscApiKeyIdAsync } from '../../../../integrations/asc/ascApiKey';
import { AppStoreConnectApiKeyQuery } from '../../../../credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery';
import { AscAppLinkMutation } from '../../../../graphql/mutations/AscAppLinkMutation';
import { AscAppLinkQuery } from '../../../../graphql/queries/AscAppLinkQuery';
import IntegrationsAscConnect from '../connect';

jest.mock('../../../../graphql/queries/AscAppLinkQuery');
jest.mock('../../../../graphql/mutations/AscAppLinkMutation');
jest.mock('../../../../credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery');
jest.mock('../../../../integrations/asc/ascApiKey');
jest.mock('../../../../log');
jest.mock('../../../../ora');

const testProjectId = 'test-project-id';
const mockMetadataConnected = {
  id: testProjectId,
  fullName: '@testuser/testapp',
  ownerAccount: { id: 'account-id', name: 'testuser', ownerUserActor: null, users: [] },
  appStoreConnectApp: {
    id: 'asc-app-link-id',
    ascAppIdentifier: '1234567890',
    remoteAppStoreConnectApp: {
      ascAppIdentifier: '1234567890',
      bundleIdentifier: 'com.test.app',
      name: 'Test App',
      appStoreIconUrl: null,
    },
  },
};

const mockMetadataDisconnected = {
  id: testProjectId,
  fullName: '@testuser/testapp',
  ownerAccount: { id: 'account-id', name: 'testuser', ownerUserActor: null, users: [] },
  appStoreConnectApp: null,
};

const mockRemoteApps = [
  {
    ascAppIdentifier: '9876543210',
    bundleIdentifier: 'com.test.newapp',
    name: 'New App',
    appStoreIconUrl: null,
  },
];

describe(IntegrationsAscConnect, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const actor = { id: 'actor-id' } as any;
  const analytics = {} as any;
  const vcsClient = {} as any;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails when already connected', async () => {
    jest.mocked(AscAppLinkQuery.getAppMetadataAsync).mockResolvedValueOnce(mockMetadataConnected);

    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'key-id', '--asc-app-id', '9876543210', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await expect(command.runAsync()).rejects.toThrow(EasCommandError);
  });

  it('connects successfully in non-interactive mode', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected)
      .mockResolvedValueOnce(mockMetadataConnected);
    jest.mocked(AscAppLinkQuery.discoverAccessibleAppsAsync).mockResolvedValueOnce(mockRemoteApps);
    jest
      .mocked(AscAppLinkMutation.createAppStoreConnectAppAsync)
      .mockResolvedValueOnce({ id: 'new-link-id', ascAppIdentifier: '9876543210' });
    jest.mocked(AppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValueOnce([
      {
        id: 'key-id',
        keyIdentifier: 'FAKEKEY000',
      },
    ] as any);

    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'FAKEKEY000', '--asc-app-id', '9876543210', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await command.runAsync();

    expect(AscAppLinkMutation.createAppStoreConnectAppAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      ascAppIdentifier: '9876543210',
      appStoreConnectApiKeyId: 'key-id',
    });
  });

  it('accepts Apple key identifier in non-interactive mode', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected)
      .mockResolvedValueOnce(mockMetadataConnected);
    jest.mocked(AscAppLinkQuery.discoverAccessibleAppsAsync).mockResolvedValueOnce(mockRemoteApps);
    jest
      .mocked(AscAppLinkMutation.createAppStoreConnectAppAsync)
      .mockResolvedValueOnce({ id: 'new-link-id', ascAppIdentifier: '9876543210' });
    jest.mocked(AppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValueOnce([
      {
        id: 'eas-key-uuid',
        keyIdentifier: 'FAKEKEY000',
      },
    ] as any);

    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'FAKEKEY000', '--asc-app-id', '9876543210', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await command.runAsync();

    expect(AscAppLinkMutation.createAppStoreConnectAppAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      ascAppIdentifier: '9876543210',
      appStoreConnectApiKeyId: 'eas-key-uuid',
    });
  });

  it('requires --api-key-id in non-interactive mode', async () => {
    const command = new IntegrationsAscConnect(
      ['--asc-app-id', '9876543210', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await expect(command.runAsync()).rejects.toThrow('--api-key-id is required');
  });

  it('requires --asc-app-id in non-interactive mode', async () => {
    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'FAKEKEY000', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await expect(command.runAsync()).rejects.toThrow('--asc-app-id is required');
  });

  it('fails when asc-app-id is not found among discovered apps', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);
    jest.mocked(AscAppLinkQuery.discoverAccessibleAppsAsync).mockResolvedValueOnce(mockRemoteApps);
    jest.mocked(AppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValueOnce([
      {
        id: 'key-id',
        keyIdentifier: 'FAKEKEY000',
      },
    ] as any);

    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'FAKEKEY000', '--asc-app-id', 'nonexistent', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await expect(command.runAsync()).rejects.toThrow('was not found among accessible apps');
  });

  it('fails when passing EAS key id in non-interactive mode', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);
    jest.mocked(AppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValueOnce([
      {
        id: 'eas-key-uuid',
        keyIdentifier: 'FAKEKEY000',
      },
    ] as any);

    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'eas-key-uuid', '--asc-app-id', '9876543210', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await expect(command.runAsync()).rejects.toThrow(
      'No App Store Connect API key found with Apple key identifier'
    );
  });

  it('fails when multiple keys match Apple key identifier', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);
    jest.mocked(AppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValueOnce([
      {
        id: 'eas-key-uuid-1',
        keyIdentifier: 'FAKEKEY000',
      },
      {
        id: 'eas-key-uuid-2',
        keyIdentifier: 'FAKEKEY000',
      },
    ] as any);

    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'FAKEKEY000', '--asc-app-id', '9876543210', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await expect(command.runAsync()).rejects.toThrow(
      'Multiple App Store Connect API keys match Apple key identifier'
    );
  });

  it('fails when no accessible apps are discovered', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);
    jest.mocked(AscAppLinkQuery.discoverAccessibleAppsAsync).mockResolvedValueOnce([]);
    jest.mocked(AppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValueOnce([
      {
        id: 'key-id',
        keyIdentifier: 'FAKEKEY000',
      },
    ] as any);

    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'FAKEKEY000', '--asc-app-id', '9876543210', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await expect(command.runAsync()).rejects.toThrow(
      'No accessible apps found on App Store Connect'
    );
  });

  it('fails when app discovery throws', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);
    jest
      .mocked(AscAppLinkQuery.discoverAccessibleAppsAsync)
      .mockRejectedValueOnce(new Error('discovery failed'));
    jest.mocked(AppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValueOnce([
      {
        id: 'key-id',
        keyIdentifier: 'FAKEKEY000',
      },
    ] as any);

    const command = new IntegrationsAscConnect(
      ['--api-key-id', 'FAKEKEY000', '--asc-app-id', '9876543210', '--non-interactive'],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await expect(command.runAsync()).rejects.toThrow('discovery failed');
  });

  it('creates or selects key when no api-key-id is provided', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected)
      .mockResolvedValueOnce(mockMetadataConnected);
    jest.mocked(AppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValueOnce([]);
    jest.mocked(selectOrCreateAscApiKeyIdAsync).mockResolvedValueOnce('generated-key-id');
    jest.mocked(AscAppLinkQuery.discoverAccessibleAppsAsync).mockResolvedValueOnce(mockRemoteApps);
    jest
      .mocked(AscAppLinkMutation.createAppStoreConnectAppAsync)
      .mockResolvedValueOnce({ id: 'new-link-id', ascAppIdentifier: '9876543210' });

    const command = new IntegrationsAscConnect(['--asc-app-id', '9876543210'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      projectDir: '/test/project',
      analytics,
      vcsClient,
      loggedIn: { graphqlClient, actor },
    });

    await command.runAsync();

    expect(selectOrCreateAscApiKeyIdAsync).toHaveBeenCalled();
    expect(AscAppLinkMutation.createAppStoreConnectAppAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      ascAppIdentifier: '9876543210',
      appStoreConnectApiKeyId: 'generated-key-id',
    });
  });
});
