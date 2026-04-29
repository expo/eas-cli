import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql/error';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AscAppLinkMutation } from '../../../../graphql/mutations/AscAppLinkMutation';
import { AscAppLinkQuery } from '../../../../graphql/queries/AscAppLinkQuery';
import Log from '../../../../log';
import { toggleConfirmAsync } from '../../../../prompts';
import IntegrationsAscDisconnect from '../disconnect';

jest.mock('../../../../graphql/queries/AscAppLinkQuery');
jest.mock('../../../../graphql/mutations/AscAppLinkMutation');
jest.mock('../../../../log');
jest.mock('../../../../ora');
jest.mock('../../../../prompts');

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

describe(IntegrationsAscDisconnect, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disconnects successfully with --yes', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataConnected)
      .mockResolvedValueOnce(mockMetadataDisconnected);
    jest.mocked(AscAppLinkMutation.deleteAppStoreConnectAppAsync).mockResolvedValueOnce(undefined);

    const command = new IntegrationsAscDisconnect(['--yes'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();

    expect(AscAppLinkMutation.deleteAppStoreConnectAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      'asc-app-link-id'
    );
    expect(AscAppLinkQuery.getAppMetadataAsync).toHaveBeenNthCalledWith(
      2,
      graphqlClient,
      testProjectId,
      {
        useCache: false,
      }
    );
  });

  it('no-op when already disconnected', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);

    const command = new IntegrationsAscDisconnect(['--yes'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();

    expect(AscAppLinkMutation.deleteAppStoreConnectAppAsync).not.toHaveBeenCalled();
    expect(jest.mocked(Log.log)).toHaveBeenCalled();
  });

  it('prints json output when already disconnected in json mode', async () => {
    jest
      .mocked(AscAppLinkQuery.getAppMetadataAsync)
      .mockResolvedValueOnce(mockMetadataDisconnected);

    const command = new IntegrationsAscDisconnect(['--yes', '--json'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();

    expect(AscAppLinkMutation.deleteAppStoreConnectAppAsync).not.toHaveBeenCalled();
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith(
      expect.stringContaining('"action": "disconnect"')
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

    const command = new IntegrationsAscDisconnect(['--yes'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await command.runAsync();
    expect(AscAppLinkMutation.deleteAppStoreConnectAppAsync).not.toHaveBeenCalled();
    expect(jest.mocked(Log.warn)).toHaveBeenCalledWith(
      expect.stringContaining('revoked or is no longer valid')
    );
  });

  it('cancels disconnection when confirmation is rejected', async () => {
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    jest.mocked(AscAppLinkQuery.getAppMetadataAsync).mockResolvedValueOnce(mockMetadataConnected);
    jest.mocked(toggleConfirmAsync).mockResolvedValueOnce(false);

    const command = new IntegrationsAscDisconnect([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId: testProjectId,
      loggedIn: { graphqlClient },
    });

    await expect(command.runAsync()).rejects.toThrow('process.exit called');
    expect(AscAppLinkMutation.deleteAppStoreConnectAppAsync).not.toHaveBeenCalled();
    processExitSpy.mockRestore();
  });
});
