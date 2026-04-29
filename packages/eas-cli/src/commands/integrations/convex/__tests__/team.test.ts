import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import { ConvexTeamConnectionData } from '../../../../graphql/types/ConvexTeamConnection';
import Log from '../../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import IntegrationsConvexTeam from '../team';

jest.mock('../../../../graphql/queries/ConvexQuery');
jest.mock('../../../../project/projectUtils');
jest.mock('../../../../log');

describe(IntegrationsConvexTeam, () => {
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
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    invitedAt: null,
    invitedEmail: null,
  };

  function createCommand(): IntegrationsConvexTeam {
    const command = new IntegrationsConvexTeam([], mockConfig);
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
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});
    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockAccount as any);
  });

  it('prints linked Convex team metadata', async () => {
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection]);

    await createCommand().runAsync();

    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining('Convex teams linked to @testuser')
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Test Team / test-team'));
    expect(Log.log).not.toHaveBeenCalledWith(expect.stringContaining('team-123'));
  });

  it('prints an empty state when no Convex teams are linked', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([]);

    await createCommand().runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('No Convex team is linked'));
  });
});
