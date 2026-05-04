import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { ConvexMutation } from '../../../../graphql/mutations/ConvexMutation';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import { ConvexTeamConnectionData } from '../../../../graphql/types/ConvexTeamConnection';
import Log from '../../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../../../prompts';
import IntegrationsConvexTeamDelete from '../team/delete';

jest.mock('../../../../graphql/queries/ConvexQuery');
jest.mock('../../../../graphql/mutations/ConvexMutation');
jest.mock('../../../../project/projectUtils');
jest.mock('../../../../prompts');
jest.mock('../../../../log');
jest.mock('../../../../ora', () => ({
  ora: () => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));

describe(IntegrationsConvexTeamDelete, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const testAccountId = 'test-account-id';
  const testAccountName = 'testuser';

  const mockAccount = {
    id: testAccountId,
    name: testAccountName,
    ownerUserActor: { id: 'test-user-id', username: testAccountName },
    users: [{ role: 'OWNER' as any, actor: { id: 'test-user-id' } }],
  };

  const mockConnection: ConvexTeamConnectionData = {
    id: 'connection-1',
    convexTeamIdentifier: 'team-123',
    convexTeamName: 'Test Team',
    convexTeamSlug: 'test-team',
    hasBeenClaimed: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    invitedAt: '2024-01-02T00:00:00.000Z',
    invitedEmail: 'user@example.com',
  };

  function createCommand(argv: string[]): IntegrationsConvexTeamDelete {
    const command = new IntegrationsConvexTeamDelete(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
      },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'error').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});

    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockAccount as any);
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection]);
    jest.mocked(ConvexMutation.deleteConvexTeamConnectionAsync).mockResolvedValue(mockConnection);
    jest.mocked(confirmAsync).mockResolvedValue(true);
  });

  it('deletes the selected Convex team link after confirmation', async () => {
    await createCommand(['test-team']).runAsync();

    expect(confirmAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('This does not destroy resources on Convex'),
    });
    expect(ConvexMutation.deleteConvexTeamConnectionAsync).toHaveBeenCalledWith(
      graphqlClient,
      'connection-1'
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Test Team / test-team'));
    expect(Log.log).not.toHaveBeenCalledWith(expect.stringContaining('team-123'));
  });

  it('skips deletion when the user cancels', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand(['test-team']).runAsync();

    expect(ConvexMutation.deleteConvexTeamConnectionAsync).not.toHaveBeenCalled();
    expect(Log.error).toHaveBeenCalledWith('Canceled deletion of the Convex team link');
  });

  it('uses --yes to skip the confirmation prompt', async () => {
    await createCommand(['test-team', '--yes']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('This does not destroy resources on Convex')
    );
    expect(ConvexMutation.deleteConvexTeamConnectionAsync).toHaveBeenCalledWith(
      graphqlClient,
      'connection-1'
    );
  });

  it('logs an empty state when no team links exist', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([]);

    await createCommand([]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('No Convex team is linked'));
    expect(ConvexMutation.deleteConvexTeamConnectionAsync).not.toHaveBeenCalled();
  });

  it('throws when the provided team is not linked to the account', async () => {
    await expect(createCommand(['missing-team']).runAsync()).rejects.toThrow(
      'Convex team missing-team is not linked to this account.'
    );
    expect(ConvexMutation.deleteConvexTeamConnectionAsync).not.toHaveBeenCalled();
  });

  it('resolves a team by slug when multiple links exist', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([
      mockConnection,
      {
        ...mockConnection,
        id: 'connection-2',
        convexTeamIdentifier: 'team-456',
        convexTeamName: 'Other Team',
        convexTeamSlug: 'other-team',
      },
    ]);

    await createCommand(['other-team', '--non-interactive', '--yes']).runAsync();

    expect(ConvexMutation.deleteConvexTeamConnectionAsync).toHaveBeenCalledWith(
      graphqlClient,
      'connection-2'
    );
  });

  it('requires a team slug in non-interactive mode when multiple links exist', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([
      mockConnection,
      {
        ...mockConnection,
        id: 'connection-2',
        convexTeamName: 'Other Team',
        convexTeamSlug: 'other-team',
      },
    ]);

    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(
      'Convex team slug must be provided'
    );
  });

  it('prompts to select a team link when multiple links exist in interactive mode', async () => {
    const otherConnection = {
      ...mockConnection,
      id: 'connection-2',
      convexTeamName: 'Other Team',
      convexTeamSlug: 'other-team',
    };
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection, otherConnection]);
    jest.mocked(selectAsync).mockResolvedValue(otherConnection);

    await createCommand(['--yes']).runAsync();

    expect(selectAsync).toHaveBeenCalledWith(
      'Select a Convex team link to remove',
      expect.any(Array)
    );
    expect(ConvexMutation.deleteConvexTeamConnectionAsync).toHaveBeenCalledWith(
      graphqlClient,
      'connection-2'
    );
  });
});
