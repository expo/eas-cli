import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AscAppLinkQuery } from '../../../../graphql/queries/AscAppLinkQuery';
import Log from '../../../../log';
import ConnectionsAscStatus from '../status';

jest.mock('../../../../graphql/queries/AscAppLinkQuery');
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

describe(ConnectionsAscStatus, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('displays connected status', async () => {
    jest.mocked(AscAppLinkQuery.getAppMetadataAsync).mockResolvedValueOnce(mockMetadataConnected);

    const command = new ConnectionsAscStatus([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();
    expect(AscAppLinkQuery.getAppMetadataAsync).toHaveBeenCalledWith(graphqlClient, testProjectId);
    expect(jest.mocked(Log.log)).toHaveBeenCalled();
  });

  it('displays disconnected status', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);

    const command = new ConnectionsAscStatus([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();
    expect(jest.mocked(Log.log)).toHaveBeenCalled();
  });

  it('prints json output in json mode', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);

    const command = new ConnectionsAscStatus(['--json'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      expect.stringContaining('"action": "status"')
    );
  });

  it('throws when fetching status fails', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockRejectedValueOnce(new Error('status failed'));

    const command = new ConnectionsAscStatus([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await expect(command.runAsync()).rejects.toThrow('status failed');
  });
});
