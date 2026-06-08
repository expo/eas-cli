import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
  PostHogRegion,
} from '../../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../../graphql/mutations/EnvironmentVariableMutation';
import { PostHogMutation } from '../../../../graphql/mutations/PostHogMutation';
import { EnvironmentVariablesQuery } from '../../../../graphql/queries/EnvironmentVariablesQuery';
import { PostHogQuery } from '../../../../graphql/queries/PostHogQuery';
import {
  PostHogOrganizationConnectionData,
  PostHogProjectData,
} from '../../../../graphql/types/PostHogConnection';
import Log from '../../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../../../prompts';
import { Actor } from '../../../../user/User';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsPostHogConnect from '../connect';

jest.mock('../../../../graphql/queries/PostHogQuery');
jest.mock('../../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../../graphql/mutations/PostHogMutation');
jest.mock('../../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../../project/projectUtils');
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

describe(IntegrationsPostHogConnect, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const testAccountId = 'test-account-id';
  const testAccountName = 'testuser';

  const mockActor: Actor = {
    __typename: 'User',
    id: 'test-user-id',
    username: testAccountName,
    email: 'user@example.com',
    featureGates: {},
    isExpoAdmin: false,
    primaryAccount: {
      id: testAccountId,
      name: testAccountName,
      ownerUserActor: null,
      users: [],
    },
    preferences: { onboarding: null },
    accounts: [],
  };

  const mockAccount = {
    id: testAccountId,
    name: testAccountName,
    ownerUserActor: { id: 'test-user-id', username: testAccountName },
    users: [{ role: 'OWNER' as any, actor: { id: 'test-user-id' } }],
  };

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
    posthogProjectName: 'testapp',
    posthogProjectToken: 'phc_public_key',
    posthogHost: 'https://us.posthog.com',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    posthogOrganizationConnection: mockConnection,
  };

  function createCommand(argv: string[], actor: Actor = mockActor): IntegrationsPostHogConnect {
    const command = new IntegrationsPostHogConnect(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { name: 'testapp', slug: 'testapp' },
        projectDir: '/test/project',
      },
      loggedIn: { graphqlClient, actor },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'withTick').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});

    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockAccount as any);
    jest.mocked(selectAsync).mockResolvedValue(PostHogRegion.Us);
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(PostHogMutation.createPostHogAccountRequestAsync).mockResolvedValue(mockConnection);
    jest.mocked(PostHogMutation.setupPostHogProjectAsync).mockResolvedValue(mockProject);
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]);
    jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockResolvedValue({
      id: 'env-var-1',
      scope: EnvironmentVariableScope.Project,
      visibility: EnvironmentVariableVisibility.Public,
      type: EnvironmentSecretType.String,
    } as any);
  });

  it('provisions a new PostHog organization + project and writes the EXPO_PUBLIC_* env vars', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand(['--region', 'US']).runAsync();

    expect(PostHogMutation.createPostHogAccountRequestAsync).toHaveBeenCalledWith(graphqlClient, {
      accountId: testAccountId,
      region: PostHogRegion.Us,
    });
    expect(PostHogMutation.setupPostHogProjectAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      posthogOrganizationConnectionId: mockConnection.id,
    });
    const createdNames = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.map(call => call[1].name);
    expect(createdNames).toEqual(
      expect.arrayContaining(['EXPO_PUBLIC_POSTHOG_API_KEY', 'EXPO_PUBLIC_POSTHOG_HOST'])
    );
    expect(jest.mocked(EnvironmentVariableMutation.createForAppAsync).mock.calls[0][1].value).toBe(
      'phc_public_key'
    );
  });

  it('reuses an existing connection and project without provisioning', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);

    await createCommand(['--region', 'US']).runAsync();

    expect(PostHogMutation.createPostHogAccountRequestAsync).not.toHaveBeenCalled();
    expect(PostHogMutation.setupPostHogProjectAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalled();
  });

  it('surfaces the existing-account dead-end without provisioning a project', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(PostHogMutation.createPostHogAccountRequestAsync).mockRejectedValue(
      Object.assign(
        new Error(
          "You already have a PostHog account. Existing-account sign-in isn't supported yet."
        ),
        {
          graphQLErrors: [
            { extensions: { errorCode: 'POSTHOG_EXISTING_USER_NOT_SUPPORTED_ERROR' } },
          ],
        }
      )
    );

    await createCommand(['--region', 'US']).runAsync();

    expect(PostHogMutation.setupPostHogProjectAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
    expect(Log.error).toHaveBeenCalledWith(
      expect.stringContaining('already have a PostHog account')
    );
  });

  it('rethrows non-dead-end provisioning errors', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);
    jest
      .mocked(PostHogMutation.createPostHogAccountRequestAsync)
      .mockRejectedValue(new Error('boom'));

    await expect(createCommand(['--region', 'US']).runAsync()).rejects.toThrow('boom');
  });

  it('updates existing env vars when present and overwrite is confirmed', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      .mockResolvedValue([{ id: 'env-existing', scope: EnvironmentVariableScope.Project } as any]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await createCommand(['--region', 'US']).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledTimes(2);
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
  });

  it('skips updating an existing env var when overwrite is declined', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      .mockResolvedValue([{ id: 'env-existing', scope: EnvironmentVariableScope.Project } as any]);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand(['--region', 'US']).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
  });

  it('requires an explicit region in non-interactive mode (no silent US default)', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);

    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(
      /region is required in non-interactive mode/
    );
    expect(PostHogMutation.createPostHogAccountRequestAsync).not.toHaveBeenCalled();
  });

  it('warns and reuses when --region differs from the existing connection region', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection); // US
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);

    await createCommand(['--region', 'EU']).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('already connected to PostHog in the US region')
    );
    expect(PostHogMutation.createPostHogAccountRequestAsync).not.toHaveBeenCalled();
  });

  it('emits JSON output with --json', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand(['--region', 'US', '--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationConnection: expect.objectContaining({ id: mockConnection.id }),
        project: expect.objectContaining({
          apiKey: 'phc_public_key',
          host: 'https://us.posthog.com',
        }),
        dashboardUrl: expect.any(String),
        environmentVariables: ['EXPO_PUBLIC_POSTHOG_API_KEY', 'EXPO_PUBLIC_POSTHOG_HOST'],
      })
    );
  });

  it('skips overwriting existing env vars in non-interactive without --overwrite', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      .mockResolvedValue([{ id: 'env-existing', scope: EnvironmentVariableScope.Project } as any]);

    await createCommand(['--non-interactive']).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('overwrites existing env vars in non-interactive with --overwrite', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      .mockResolvedValue([{ id: 'env-existing', scope: EnvironmentVariableScope.Project } as any]);

    await createCommand(['--non-interactive', '--overwrite']).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledTimes(2);
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('prompts for the region interactively when none exists and --region is omitted', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand([]).runAsync();

    expect(selectAsync).toHaveBeenCalled();
    expect(PostHogMutation.createPostHogAccountRequestAsync).toHaveBeenCalledWith(graphqlClient, {
      accountId: testAccountId,
      region: PostHogRegion.Us,
    });
  });

  it('rethrows when project setup fails', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);
    jest
      .mocked(PostHogMutation.setupPostHogProjectAsync)
      .mockRejectedValue(new Error('setup boom'));

    await expect(createCommand(['--region', 'US']).runAsync()).rejects.toThrow('setup boom');
  });

  it('rejects an unsupported region value', async () => {
    const command = createCommand([]);

    await expect((command as any).resolveRegionAsync('INVALID', false)).rejects.toThrow(
      /Unsupported PostHog region/
    );
  });
});
