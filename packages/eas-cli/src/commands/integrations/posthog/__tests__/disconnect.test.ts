import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { PostHogRegion } from '../../../../graphql/generated';
import { PostHogMutation } from '../../../../graphql/mutations/PostHogMutation';
import { PostHogQuery } from '../../../../graphql/queries/PostHogQuery';
import {
  PostHogOrganizationConnectionData,
  PostHogProjectData,
} from '../../../../graphql/types/PostHogConnection';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsPostHogDisconnect from '../disconnect';

jest.mock('../../../../graphql/queries/PostHogQuery');
jest.mock('../../../../graphql/mutations/PostHogMutation');
jest.mock('../../../../prompts');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../ora', () => ({
  ora: () => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));

describe(IntegrationsPostHogDisconnect, () => {
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

  function createCommand(argv: string[]): IntegrationsPostHogDisconnect {
    const command = new IntegrationsPostHogDisconnect(argv, mockConfig);
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
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest.mocked(PostHogMutation.deletePostHogProjectAsync).mockResolvedValue(mockProject.id);
    jest.mocked(confirmAsync).mockResolvedValue(true);
  });

  it('removes the project link after confirmation', async () => {
    await createCommand([]).runAsync();

    expect(PostHogMutation.deletePostHogProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      mockProject.id
    );
  });

  it('skips the prompt with --yes', async () => {
    await createCommand(['--yes']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(PostHogMutation.deletePostHogProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      mockProject.id
    );
  });

  it('does nothing when the user declines confirmation', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand([]).runAsync();

    expect(PostHogMutation.deletePostHogProjectAsync).not.toHaveBeenCalled();
  });

  it('deletes after a warning in non-interactive mode, noting PostHog data is preserved', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not delete the project on PostHog')
    );
    expect(PostHogMutation.deletePostHogProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      mockProject.id
    );
  });

  it('logs an empty state when no project link exists', async () => {
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand([]).runAsync();

    expect(PostHogMutation.deletePostHogProjectAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No PostHog project is linked to Expo app')
    );
  });

  it('emits JSON output with --json and skips the prompt', async () => {
    await createCommand(['--json']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(PostHogMutation.deletePostHogProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      mockProject.id
    );
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      id: mockProject.id,
      name: mockProject.posthogProjectName,
    });
  });

  it('emits a null id as JSON when no project is linked', async () => {
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand(['--json']).runAsync();

    expect(PostHogMutation.deletePostHogProjectAsync).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ id: null });
  });

  it('rethrows when the delete mutation fails', async () => {
    jest
      .mocked(PostHogMutation.deletePostHogProjectAsync)
      .mockRejectedValue(new Error('delete boom'));

    await expect(createCommand(['--yes']).runAsync()).rejects.toThrow('delete boom');
  });
});
