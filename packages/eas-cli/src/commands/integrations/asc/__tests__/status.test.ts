import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql/error';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AscAppLinkQuery } from '../../../../graphql/queries/AscAppLinkQuery';
import Log from '../../../../log';
import IntegrationsAscStatus from '../status';

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

describe(IntegrationsAscStatus, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('displays connected status', async () => {
    jest.mocked(AscAppLinkQuery.getAppMetadataAsync).mockResolvedValueOnce(mockMetadataConnected);

    const command = new IntegrationsAscStatus([], mockConfig);
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

    const command = new IntegrationsAscStatus([], mockConfig);
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

    const command = new IntegrationsAscStatus(['--json'], mockConfig);
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

  it('handles invalid ASC API key gracefully', async () => {
    const ascError = new CombinedError({
      graphQLErrors: [
        new GraphQLError(
          'App Store Connect rejected this API key with status 401. Choose a valid API key and try again.'
        ),
      ],
    });
    jest.mocked(AscAppLinkQuery.getAppMetadataAsync).mockRejectedValueOnce(ascError);

    const command = new IntegrationsAscStatus([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();
    expect(jest.mocked(Log.warn)).toHaveBeenCalledWith(
      expect.stringContaining('revoked or is no longer valid')
    );
  });

  it('handles invalid ASC API key with json output', async () => {
    const ascError = new CombinedError({
      graphQLErrors: [
        new GraphQLError(
          'App Store Connect rejected this API key with status 401. Choose a valid API key and try again.'
        ),
      ],
    });
    jest.mocked(AscAppLinkQuery.getAppMetadataAsync).mockRejectedValueOnce(ascError);

    const command = new IntegrationsAscStatus(['--json'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      expect.stringContaining('"status": "invalid"')
    );
  });

  it('throws when fetching status fails', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockRejectedValueOnce(new Error('status failed'));

    const command = new IntegrationsAscStatus([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await expect(command.runAsync()).rejects.toThrow('status failed');
  });
});
