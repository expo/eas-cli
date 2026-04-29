import openBrowserAsync from 'better-opn';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import {
  ConvexProjectData,
  ConvexTeamConnectionData,
} from '../../../../graphql/types/ConvexTeamConnection';
import Log from '../../../../log';
import { ora } from '../../../../ora';
import IntegrationsConvexDashboard from '../dashboard';

jest.mock('better-opn');
jest.mock('../../../../graphql/queries/ConvexQuery');
jest.mock('../../../../log');
jest.mock('../../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

describe(IntegrationsConvexDashboard, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  const mockConnection: ConvexTeamConnectionData = {
    id: 'connection-1',
    convexTeamIdentifier: 'team-123',
    convexTeamName: 'Test Team',
    convexTeamSlug: 'test team',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    invitedAt: null,
    invitedEmail: null,
  };

  const mockProject: ConvexProjectData = {
    id: 'convex-project-1',
    convexProjectIdentifier: 'project-123',
    convexProjectName: 'Test Project',
    convexProjectSlug: 'test project',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    convexTeamConnection: mockConnection,
  };

  function createCommand(): IntegrationsConvexDashboard {
    const command = new IntegrationsConvexDashboard([], mockConfig);
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
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.mocked(ConvexQuery.getConvexProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest.mocked(openBrowserAsync).mockResolvedValue({} as never);
    jest.mocked(ora).mockReturnValue({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    } as any);
  });

  it('opens the linked Convex project dashboard', async () => {
    await createCommand().runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://dashboard.convex.dev/t/test%20team/test%20project'
    );
  });

  it('logs an empty state when no project link exists', async () => {
    jest.mocked(ConvexQuery.getConvexProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand().runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No Convex project is linked to Expo app')
    );
  });

  it('fails the spinner when the browser cannot be opened', async () => {
    jest.mocked(openBrowserAsync).mockResolvedValue(false);
    const spinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    jest.mocked(ora).mockReturnValue(spinner as any);

    await createCommand().runAsync();

    expect(spinner.fail).toHaveBeenCalledWith(
      expect.stringContaining('Unable to open a web browser')
    );
  });

  it('fails the spinner and rethrows when opening the browser throws', async () => {
    jest.mocked(openBrowserAsync).mockRejectedValue(new Error('open failed'));
    const spinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    jest.mocked(ora).mockReturnValue(spinner as any);

    await expect(createCommand().runAsync()).rejects.toThrow('open failed');

    expect(spinner.fail).toHaveBeenCalledWith(
      expect.stringContaining('Unable to open a web browser')
    );
  });
});
