import openBrowserAsync from 'better-opn';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { PostHogDeepLinkPurpose, PostHogRegion } from '../../../../graphql/generated';
import { PostHogMutation } from '../../../../graphql/mutations/PostHogMutation';
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
jest.mock('../../../../graphql/mutations/PostHogMutation');
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

  const deepLinkUrl = 'https://us.posthog.com/agentic/login?token=deeplink&team_id=res-123';

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
    jest.mocked(PostHogMutation.createPostHogDeepLinkAsync).mockResolvedValue(deepLinkUrl);
    jest.mocked(openBrowserAsync).mockResolvedValue({} as never);
    jest.mocked(ora).mockReturnValue({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    } as any);
  });

  it('mints a signed-in deep link for the linked project and opens it', async () => {
    await createCommand().runAsync();

    expect(PostHogMutation.createPostHogDeepLinkAsync).toHaveBeenCalledWith(graphqlClient, {
      posthogOrganizationConnectionId: 'connection-1',
      appId: testProjectId,
      purpose: PostHogDeepLinkPurpose.Dashboard,
    });
    expect(openBrowserAsync).toHaveBeenCalledWith(deepLinkUrl);
  });

  it('does not print the one-time deep-link token by default', async () => {
    const spinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    jest.mocked(ora).mockReturnValue(spinner as any);

    await createCommand().runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(deepLinkUrl);
    expect(spinner.succeed).toHaveBeenCalledWith('Opened your PostHog dashboard');
    expect(spinner.succeed).not.toHaveBeenCalledWith(expect.stringContaining('token='));
  });

  it('prints the signed-in deep-link URL when --show-link is set', async () => {
    const spinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    jest.mocked(ora).mockReturnValue(spinner as any);

    await createCommand(['--show-link']).runAsync();

    expect(openBrowserAsync).toHaveBeenCalledWith(deepLinkUrl);
    expect(spinner.succeed).toHaveBeenCalledWith(`Opened ${deepLinkUrl}`);
  });

  it('falls back to the static (login-required) URL when minting a deep link fails', async () => {
    jest
      .mocked(PostHogMutation.createPostHogDeepLinkAsync)
      .mockRejectedValue(new Error('deep links not enabled'));
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
    expect(spinner.fail).toHaveBeenCalledWith(
      expect.stringContaining('https://us.posthog.com/project/res-123')
    );
    expect(spinner.fail).not.toHaveBeenCalledWith(expect.stringContaining('token='));
  });

  it('prints the stable static URL (not a one-time deep link) in non-interactive mode', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(PostHogMutation.createPostHogDeepLinkAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith('https://us.posthog.com/project/res-123');
  });

  it('emits the stable static URL as JSON with --json (not a one-time deep link)', async () => {
    await createCommand(['--json']).runAsync();

    expect(openBrowserAsync).not.toHaveBeenCalled();
    expect(PostHogMutation.createPostHogDeepLinkAsync).not.toHaveBeenCalled();
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
