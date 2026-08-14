import dateFormat from 'dateformat';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { ConvexMutation } from '../../../../graphql/mutations/ConvexMutation';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import { ConvexTeamConnectionData } from '../../../../graphql/types/ConvexTeamConnection';
import Log from '../../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../../../prompts';
import IntegrationsConvexTeamInvite from '../team/invite';

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

describe(IntegrationsConvexTeamInvite, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const testAccountId = 'test-account-id';
  const testAccountName = 'testuser';

  const mockActor = {
    __typename: 'User',
    id: 'test-user-id',
    email: 'user@example.com',
    accounts: [],
  };

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
    invitedEmail: 'previous@example.com',
  };

  function createCommand(
    argv: string[],
    actor: { __typename: string; [key: string]: any } = mockActor
  ): IntegrationsConvexTeamInvite {
    const command = new IntegrationsConvexTeamInvite(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
      },
      loggedIn: { graphqlClient, actor },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});

    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockAccount as any);
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection]);
    jest.mocked(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).mockResolvedValue(true);
    jest.mocked(confirmAsync).mockResolvedValue(true);
  });

  it('sends an invite for the linked Convex team', async () => {
    await createCommand([]).runAsync();

    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).toHaveBeenCalledWith(
      graphqlClient,
      { convexTeamConnectionId: 'connection-1' }
    );
  });

  it('prints previous invite metadata when it exists', async () => {
    await createCommand([]).runAsync();

    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Test Team / test-team'));
    expect(Log.log).not.toHaveBeenCalledWith(expect.stringContaining('team-123'));
    expect(Log.log).not.toHaveBeenCalledWith(expect.stringContaining('connection-1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Previous invite'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Claimed'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('No'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('previous@example.com'));
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining(dateFormat(mockConnection.invitedAt, 'mmm dd HH:MM:ss'))
    );
  });

  it('prompts before resending a recent invite', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([
      {
        ...mockConnection,
        invitedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    ]);

    await createCommand([]).runAsync();

    expect(confirmAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('Are you sure you want to send another invite?'),
    });
    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).toHaveBeenCalled();
  });

  it('skips resending a recent invite when the user does not confirm', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([
      {
        ...mockConnection,
        invitedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    ]);

    await createCommand([]).runAsync();

    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith('Skipped sending Convex team invitation.');
  });

  it('skips sending an invite when the Convex team has already been claimed', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([
      {
        ...mockConnection,
        hasBeenClaimed: true,
        invitedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    ]);

    await createCommand([]).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      'Convex team has already been claimed. Skipping Convex team invitation.'
    );
  });

  it('resends recent invites in non-interactive mode with a warning', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([
      {
        ...mockConnection,
        invitedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    ]);

    await createCommand(['--non-interactive']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('non-interactive mode'));
    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).toHaveBeenCalled();
  });

  it('skips the invite when the actor has no email', async () => {
    await createCommand([], { __typename: 'Robot', id: 'robot-1' }).runAsync();

    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not determine your verified email address')
    );
    expect(Log.warn).not.toHaveBeenCalledWith(expect.stringContaining('Convex dashboard'));
  });

  it('selects a team link when multiple are available', async () => {
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

    await createCommand([]).runAsync();

    expect(selectAsync).toHaveBeenCalledWith(
      'Select a Convex team link to invite yourself to',
      expect.any(Array)
    );
    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).toHaveBeenCalledWith(
      graphqlClient,
      { convexTeamConnectionId: 'connection-2' }
    );
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

    await createCommand(['other-team', '--non-interactive']).runAsync();

    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).toHaveBeenCalledWith(
      graphqlClient,
      { convexTeamConnectionId: 'connection-2' }
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
});
