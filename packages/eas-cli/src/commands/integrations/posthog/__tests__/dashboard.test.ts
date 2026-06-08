import openBrowserAsync from 'better-opn';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { PostHogRegion } from '../../../../graphql/generated';
import { PostHogQuery } from '../../../../graphql/queries/PostHogQuery';
import {
  PostHogOrganizationConnectionData,
  PostHogProjectData,
} from '../../../../graphql/types/PostHogConnection';
import Log from '../../../../log';
import { ora } from '../../../../ora';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsPostHogDashboard from '../dashboard';

jest.mock('better-opn');
jest.mock('../../../../graphql/queries/PostHogQuery');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

describe(IntegrationsPostHogDashboard, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  const mockConnection: PostHogOrganizationConnectionData = {
    id: 'connection-1',
    posthogOrganizationIdentifier: 'org-123',
    posthogOrganizationName: 'Test Org',
    posthogRegion: PostHogRegion.Us,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockProject: PostHogProjectData = {
    id: 'project-1',
    posthogProjectIdentifier: 'res-123',
    posthogProjectName: 'Test Project',
    posthogProjectToken: 'phc_public_key',
    posthogHost: 'https://us.posthog.com',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    posthogOrganizationConnection: mockConnection,
  };

  function createCommand(argv: string[] = []): IntegrationsPostHogDashboard {
    const command = new IntegrationsPostHogDashboard(argv, mockConfig);
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
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest.mocked(openBrowserAsync).mockResolvedValue({} as never);
    jest.mocked(ora).mockReturnValue({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    } as any);
  });

  it('opens the linked PostHog project dashboard', async () => {
    await createCommand().runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith('https://us.posthog.com/project/res-123');
  });

  it('normalizes a trailing-slash host and percent-encodes the project identifier', async () => {
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue({
      ...mockProject,
      posthogHost: 'https://us.posthog.com/',
      posthogProjectIdentifier: 'team a/b',
    });

    await createCommand().runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith('https://us.posthog.com/project/team%20a%2Fb');
  });

  it('logs an empty state when no project link exists', async () => {
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand().runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No PostHog project is linked to Expo app')
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

  it('prints the dashboard URL in non-interactive mode without opening a browser', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith('https://us.posthog.com/project/res-123');
  });

  it('emits the dashboard URL as JSON with --json', async () => {
    await createCommand(['--json']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      dashboardUrl: 'https://us.posthog.com/project/res-123',
    });
  });

  it('emits a null dashboardUrl as JSON when no project is linked', async () => {
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand(['--json']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ dashboardUrl: null });
  });

  it('fails the spinner and rethrows when opening the browser throws', async () => {
    jest.mocked(openBrowserAsync).mockRejectedValue(new Error('no browser'));
    const spinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    jest.mocked(ora).mockReturnValue(spinner as any);

    await expect(createCommand().runAsync()).rejects.toThrow('no browser');
    expect(spinner.fail).toHaveBeenCalled();
  });
});
