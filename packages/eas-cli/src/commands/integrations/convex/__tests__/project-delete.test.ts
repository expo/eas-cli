import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { ConvexMutation } from '../../../../graphql/mutations/ConvexMutation';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import {
  ConvexProjectData,
  ConvexTeamConnectionData,
} from '../../../../graphql/types/ConvexTeamConnection';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import IntegrationsConvexProjectDelete from '../project/delete';

jest.mock('../../../../graphql/queries/ConvexQuery');
jest.mock('../../../../graphql/mutations/ConvexMutation');
jest.mock('../../../../prompts');
jest.mock('../../../../log');
jest.mock('../../../../ora', () => ({
  ora: () => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));

describe(IntegrationsConvexProjectDelete, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

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

  const mockProject: ConvexProjectData = {
    id: 'convex-project-1',
    convexProjectIdentifier: 'project-123',
    convexProjectName: 'Test Project',
    convexProjectSlug: 'test-project',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    convexTeamConnection: mockConnection,
  };

  function createCommand(argv: string[]): IntegrationsConvexProjectDelete {
    const command = new IntegrationsConvexProjectDelete(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { slug: 'testapp' },
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

    jest.mocked(ConvexQuery.getConvexProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest.mocked(ConvexMutation.deleteConvexProjectAsync).mockResolvedValue('convex-project-1');
    jest.mocked(confirmAsync).mockResolvedValue(true);
  });

  it('deletes the linked Convex project after confirmation', async () => {
    await createCommand([]).runAsync();

    expect(confirmAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('This does not destroy resources on Convex'),
    });
    expect(ConvexMutation.deleteConvexProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      'convex-project-1'
    );
  });

  it('skips deletion when the user cancels', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand([]).runAsync();

    expect(ConvexMutation.deleteConvexProjectAsync).not.toHaveBeenCalled();
    expect(Log.error).toHaveBeenCalledWith('Canceled deletion of the Convex project link');
  });

  it('uses --yes to skip the confirmation prompt', async () => {
    await createCommand(['--yes']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('This does not destroy resources on Convex')
    );
    expect(ConvexMutation.deleteConvexProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      'convex-project-1'
    );
  });

  it('logs an empty state when no project link exists', async () => {
    jest.mocked(ConvexQuery.getConvexProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand([]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No Convex project is linked to Expo app')
    );
    expect(ConvexMutation.deleteConvexProjectAsync).not.toHaveBeenCalled();
  });
});
