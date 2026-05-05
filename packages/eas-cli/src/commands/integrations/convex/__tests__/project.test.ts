import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import {
  ConvexProjectData,
  ConvexTeamConnectionData,
} from '../../../../graphql/types/ConvexTeamConnection';
import Log from '../../../../log';
import IntegrationsConvexProject from '../project';

jest.mock('../../../../graphql/queries/ConvexQuery');
jest.mock('../../../../log');

describe(IntegrationsConvexProject, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  const mockConnection: ConvexTeamConnectionData = {
    id: 'connection-1',
    convexTeamIdentifier: 'team-123',
    convexTeamName: 'Test Team',
    convexTeamSlug: 'test-team',
    hasBeenClaimed: false,
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

  function createCommand(): IntegrationsConvexProject {
    const command = new IntegrationsConvexProject([], mockConfig);
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
  });

  it('prints linked Convex project metadata', async () => {
    jest.mocked(ConvexQuery.getConvexProjectByAppIdAsync).mockResolvedValue(mockProject);

    await createCommand().runAsync();

    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining('Convex project linked to testapp')
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('project-123'));
  });

  it('prints an empty state when no Convex project is linked', async () => {
    jest.mocked(ConvexQuery.getConvexProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand().runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No Convex project is linked to Expo app')
    );
  });
});
