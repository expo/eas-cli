import spawnAsync from '@expo/spawn-async';
import * as fs from 'fs-extra';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
  PostHogRegion,
  Role,
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
import { createOrModifyExpoConfigAsync } from '../../../../project/expoConfig';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../../../prompts';
import { Actor } from '../../../../user/User';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsPostHogConnect from '../connect';

jest.mock('@expo/spawn-async');
jest.mock('fs-extra');
jest.mock('../../../../project/expoConfig');
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
    primaryAccount: { id: testAccountId, name: testAccountName, ownerUserActor: null, users: [] },
    preferences: { onboarding: null },
    accounts: [],
  };

  const mockAccount = {
    id: testAccountId,
    name: testAccountName,
    ownerUserActor: { id: 'test-user-id', username: testAccountName },
    users: [{ role: Role.Owner, actor: { id: 'test-user-id' } }],
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
    posthogProjectIdentifier: '467657',
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
        exp: { name: 'testapp', slug: 'testapp', plugins: [] },
        projectDir: '/test/project',
      },
      loggedIn: { graphqlClient, actor },
    } as never);
    return command;
  }

  // Helper: which features the interactive multiselect returns.
  function mockFeatureSelection(features: string[]): void {
    jest.mocked(promptAsync).mockImplementation((async (opts: any) => {
      if (opts.name === 'features') {
        return { features };
      }
      if (opts.name === 'apiKey') {
        return { apiKey: 'phx_personal_key' };
      }
      return {};
    }) as any);
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'error').mockImplementation(() => {});
    jest.spyOn(Log, 'withTick').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});

    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockAccount as any);
    jest.mocked(selectAsync).mockResolvedValue(PostHogRegion.Us);
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(spawnAsync).mockResolvedValue({} as any);
    jest.mocked(fs.pathExists).mockResolvedValue(false as never);
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({ type: 'success' } as any);
    // Default: reuse an existing connection + project.
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest.mocked(PostHogMutation.createPostHogAccountRequestAsync).mockResolvedValue(mockConnection);
    jest.mocked(PostHogMutation.setupPostHogProjectAsync).mockResolvedValue(mockProject);
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]);
    jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockResolvedValue({
      id: 'env-var-1',
      scope: EnvironmentVariableScope.Project,
    } as any);
    mockFeatureSelection(['analytics', 'session-replay', 'error-tracking']);
  });

  it('sets up all features: installs SDK + replay pkg, adds plugin, writes EXPO_PUBLIC_ + POSTHOG_CLI_ vars', async () => {
    await createCommand([]).runAsync();

    const installArgs = jest.mocked(spawnAsync).mock.calls[0][1];
    expect(installArgs).toContain('posthog-react-native');
    expect(installArgs).toContain('posthog-react-native-session-replay');
    expect(createOrModifyExpoConfigAsync).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalled();

    const createdNames = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.map(call => call[1].name);
    expect(createdNames).toEqual(
      expect.arrayContaining([
        'EXPO_PUBLIC_POSTHOG_API_KEY',
        'EXPO_PUBLIC_POSTHOG_HOST',
        'POSTHOG_CLI_API_KEY',
        'POSTHOG_CLI_PROJECT_ID',
        'POSTHOG_CLI_HOST',
      ])
    );
    const cliKeyVar = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.find(call => call[1].name === 'POSTHOG_CLI_API_KEY');
    expect(cliKeyVar?.[1].visibility).toBe(EnvironmentVariableVisibility.Sensitive);
    // The pasted personal key flows through verbatim — to EAS and to .env.local.
    expect(cliKeyVar?.[1].value).toBe('phx_personal_key');
    const written = jest.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(written).toContain('POSTHOG_CLI_API_KEY=phx_personal_key');
  });

  it('asks for features only after provisioning (fast-forward ordering)', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);
    let provisionedBeforePrompt = false;
    jest.mocked(promptAsync).mockImplementation((async (opts: any) => {
      if (opts.name === 'features') {
        provisionedBeforePrompt =
          jest.mocked(PostHogMutation.createPostHogAccountRequestAsync).mock.calls.length > 0 &&
          jest.mocked(PostHogMutation.setupPostHogProjectAsync).mock.calls.length > 0;
        return { features: ['analytics'] };
      }
      return {};
    }) as any);

    await createCommand(['--region', 'US']).runAsync();

    expect(provisionedBeforePrompt).toBe(true);
  });

  it('analytics only: no replay pkg, no CLI vars, no key prompt', async () => {
    mockFeatureSelection(['analytics']);

    await createCommand([]).runAsync();

    expect(jest.mocked(spawnAsync).mock.calls[0][1]).not.toContain(
      'posthog-react-native-session-replay'
    );
    const createdNames = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.map(call => call[1].name);
    expect(createdNames).toEqual(['EXPO_PUBLIC_POSTHOG_API_KEY', 'EXPO_PUBLIC_POSTHOG_HOST']);
    expect(promptAsync).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'apiKey' }));
  });

  it('adds the config plugin and public env vars for session-replay-only (analytics deselected)', async () => {
    mockFeatureSelection(['session-replay']);

    await createCommand([]).runAsync();

    // The plugin wires native modules replay needs, so it must be added even without analytics.
    expect(createOrModifyExpoConfigAsync).toHaveBeenCalled();
    expect(jest.mocked(spawnAsync).mock.calls[0][1]).toContain(
      'posthog-react-native-session-replay'
    );
    // The public key + host initialize the SDK for any feature, so they're still written.
    const createdNames = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.map(call => call[1].name);
    expect(createdNames).toEqual(['EXPO_PUBLIC_POSTHOG_API_KEY', 'EXPO_PUBLIC_POSTHOG_HOST']);
  });

  it('routes the install child off stdout in --json mode', async () => {
    await createCommand(['--json', '--posthog-cli-api-key', 'phx_x']).runAsync();

    // stdout must carry only the JSON document, so the child writes to fd 2 (stderr).
    expect(jest.mocked(spawnAsync).mock.calls[0][2]).toEqual(
      expect.objectContaining({ stdio: ['ignore', 2, 2] })
    );
  });

  it('non-interactive defaults: analytics + replay, error tracking auto-skipped', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(promptAsync).not.toHaveBeenCalled();
    const createdNames = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.map(call => call[1].name);
    expect(createdNames).not.toContain('POSTHOG_CLI_API_KEY');
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping error tracking'));
    // Session replay defaults on, so its package is still installed.
    expect(jest.mocked(spawnAsync).mock.calls[0][1]).toContain(
      'posthog-react-native-session-replay'
    );
  });

  it('non-interactive --error-tracking without a key fails before any provisioning', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);

    await expect(
      createCommand(['--non-interactive', '--error-tracking']).runAsync()
    ).rejects.toThrow(/personal API key in non-interactive/);

    expect(PostHogMutation.createPostHogAccountRequestAsync).not.toHaveBeenCalled();
  });

  it('non-interactive --error-tracking with --posthog-cli-api-key sets up CLI vars without prompting', async () => {
    await createCommand([
      '--non-interactive',
      '--error-tracking',
      '--posthog-cli-api-key',
      'phx_from_flag',
    ]).runAsync();

    expect(promptAsync).not.toHaveBeenCalled();
    const cliKeyVar = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.find(call => call[1].name === 'POSTHOG_CLI_API_KEY');
    expect(cliKeyVar?.[1].value).toBe('phx_from_flag');
  });

  it('treats a whitespace-only --posthog-cli-api-key as absent (fails like no key)', async () => {
    await expect(
      createCommand([
        '--non-interactive',
        '--error-tracking',
        '--posthog-cli-api-key',
        '   ',
      ]).runAsync()
    ).rejects.toThrow(/personal API key in non-interactive/);
  });

  it('warns and prints manual edit when the app config is dynamic', async () => {
    mockFeatureSelection(['analytics']);
    jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({
      type: 'warn',
      message: 'Cannot automatically write to dynamic config',
    } as any);

    await createCommand([]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cannot automatically write to dynamic config')
    );
    // Falls back to actionable manual-edit instructions.
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining('Add the PostHog config plugin to your app config')
    );
  });

  it('reuses an existing connection + project without provisioning', async () => {
    await createCommand([]).runAsync();

    expect(PostHogMutation.createPostHogAccountRequestAsync).not.toHaveBeenCalled();
    expect(PostHogMutation.setupPostHogProjectAsync).not.toHaveBeenCalled();
  });

  it('surfaces the existing-account dead-end without provisioning a project', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(PostHogMutation.createPostHogAccountRequestAsync).mockRejectedValue(
      Object.assign(new Error('You already have a PostHog account.'), {
        graphQLErrors: [{ extensions: { errorCode: 'POSTHOG_EXISTING_USER_NOT_SUPPORTED_ERROR' } }],
      })
    );

    await expect(createCommand(['--region', 'US']).runAsync()).rejects.toThrow(
      'You already have a PostHog account.'
    );

    // Fails (non-zero exit) without provisioning a project or writing any config.
    expect(PostHogMutation.setupPostHogProjectAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('emits JSON output with --json', async () => {
    await createCommand(['--json', '--posthog-cli-api-key', 'phx_x']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ apiKey: 'phc_public_key' }),
        // --json supplies the key, so error tracking is on and its vars are reported.
        features: expect.objectContaining({ analytics: true, errorTracking: true }),
        dashboardUrl: expect.any(String),
        environmentVariables: expect.arrayContaining([
          'EXPO_PUBLIC_POSTHOG_API_KEY',
          'POSTHOG_CLI_API_KEY',
          'POSTHOG_CLI_PROJECT_ID',
          'POSTHOG_CLI_HOST',
        ]),
      })
    );
  });

  it('requires --region in non-interactive mode when provisioning', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);

    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(
      /region is required in non-interactive/
    );
  });

  it('warns when --region differs from the already-connected region', async () => {
    await createCommand(['--region', 'EU']).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('already connected to PostHog'));
  });

  it('provisions a new connection and project when none exist', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);
    mockFeatureSelection(['analytics']);

    await createCommand(['--region', 'US']).runAsync();

    expect(PostHogMutation.createPostHogAccountRequestAsync).toHaveBeenCalledWith(graphqlClient, {
      accountId: testAccountId,
      region: PostHogRegion.Us,
    });
    expect(PostHogMutation.setupPostHogProjectAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      posthogOrganizationConnectionId: mockConnection.id,
    });
  });

  it('rethrows a non-dead-end provisioning failure', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest
      .mocked(PostHogMutation.createPostHogAccountRequestAsync)
      .mockRejectedValue(new Error('network down'));

    await expect(createCommand(['--region', 'US']).runAsync()).rejects.toThrow('network down');
  });

  it('rethrows when project setup fails', async () => {
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);
    jest
      .mocked(PostHogMutation.setupPostHogProjectAsync)
      .mockRejectedValue(new Error('setup failed'));

    await expect(createCommand([]).runAsync()).rejects.toThrow('setup failed');
  });

  it('honors explicit --no-session-replay without showing the feature multiselect', async () => {
    await createCommand(['--no-session-replay']).runAsync();

    expect(promptAsync).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'features' }));
    expect(jest.mocked(spawnAsync).mock.calls[0][1]).not.toContain(
      'posthog-react-native-session-replay'
    );
  });

  it('prompts for a personal API key and validates it', async () => {
    await createCommand([]).runAsync();

    const apiKeyPrompt = jest
      .mocked(promptAsync)
      .mock.calls.map(call => call[0])
      .find((opts: any) => opts.name === 'apiKey') as any;
    expect(apiKeyPrompt).toBeDefined();
    expect(apiKeyPrompt.validate('')).toBe('Personal API key cannot be empty');
    expect(apiKeyPrompt.validate('phx_real')).toBe(true);
  });

  it('rethrows and warns when SDK installation fails', async () => {
    mockFeatureSelection(['analytics']);
    jest.mocked(spawnAsync).mockRejectedValue(new Error('npm exploded'));

    await expect(createCommand([]).runAsync()).rejects.toThrow('npm exploded');
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to install'));
  });

  it('skips the config plugin when it is already configured', async () => {
    mockFeatureSelection(['analytics']);
    const command = createCommand([]);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { name: 'testapp', slug: 'testapp', plugins: ['posthog-react-native/expo'] },
        projectDir: '/test/project',
      },
      loggedIn: { graphqlClient, actor: mockActor },
    } as never);

    await command.runAsync();

    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
  });

  it('does nothing local when no features are selected (no install, no writes)', async () => {
    mockFeatureSelection([]);

    await createCommand([]).runAsync();

    expect(spawnAsync).not.toHaveBeenCalled();
    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('No PostHog features selected'));
  });

  it('merges into an existing .env.local, replacing matching keys and appending new ones', async () => {
    mockFeatureSelection(['analytics']);
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest
      .mocked(fs.readFile)
      .mockResolvedValue('EXPO_PUBLIC_POSTHOG_API_KEY=old_value\nOTHER=keep' as never);

    await createCommand([]).runAsync();

    const written = jest.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(written).toContain('EXPO_PUBLIC_POSTHOG_API_KEY=phc_public_key');
    expect(written).toContain('OTHER=keep');
    expect(written).toContain('EXPO_PUBLIC_POSTHOG_HOST=https://us.posthog.com');
  });

  it('prompts for a region interactively when provisioning without --region', async () => {
    jest
      .mocked(PostHogQuery.getPostHogOrganizationConnectionByAccountIdAsync)
      .mockResolvedValue(null);
    jest.mocked(PostHogQuery.getPostHogProjectByAppIdAsync).mockResolvedValue(null);
    mockFeatureSelection(['analytics']);

    await createCommand([]).runAsync();

    expect(selectAsync).toHaveBeenCalledWith('Select a PostHog region', expect.any(Array));
    expect(PostHogMutation.createPostHogAccountRequestAsync).toHaveBeenCalledWith(graphqlClient, {
      accountId: testAccountId,
      region: PostHogRegion.Us,
    });
  });

  it('skips .env.local when the user declines to overwrite a conflict', async () => {
    mockFeatureSelection(['analytics']);
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue('EXPO_PUBLIC_POSTHOG_API_KEY=old_value\n' as never);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand([]).runAsync();

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped updating'));
  });

  it('--overwrite writes .env.local without prompting on a conflict', async () => {
    mockFeatureSelection(['analytics']);
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue('EXPO_PUBLIC_POSTHOG_API_KEY=old_value\n' as never);

    await createCommand(['--overwrite']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    const written = jest.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(written).toContain('EXPO_PUBLIC_POSTHOG_API_KEY=phc_public_key');
  });

  it('non-interactively skips an existing .env.local key without --overwrite', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue('EXPO_PUBLIC_POSTHOG_API_KEY=old_value\n' as never);

    await createCommand(['--non-interactive']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('pass --overwrite to replace'));
  });

  it('non-interactively overwrites an existing .env.local key with --overwrite', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue('EXPO_PUBLIC_POSTHOG_API_KEY=old_value\n' as never);

    await createCommand(['--non-interactive', '--overwrite']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    const written = jest.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(written).toContain('EXPO_PUBLIC_POSTHOG_API_KEY=phc_public_key');
  });

  it('writes a personal API key containing $ verbatim (no replacement-pattern expansion)', async () => {
    const command = createCommand([]);
    const merged = (command as any).mergeEnvContent('POSTHOG_CLI_API_KEY=old\n', {
      POSTHOG_CLI_API_KEY: 'phx_a$2b$&c',
    });
    expect(merged).toContain('POSTHOG_CLI_API_KEY=phx_a$2b$&c');
  });

  it('updates an existing EAS environment variable with --overwrite', async () => {
    mockFeatureSelection(['analytics']);
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      .mockResolvedValue([{ id: 'existing-1', scope: EnvironmentVariableScope.Project }] as any);
    jest
      .mocked(EnvironmentVariableMutation.updateAsync)
      .mockResolvedValue({ id: 'existing-1' } as any);

    await createCommand(['--overwrite']).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
  });

  it('honors explicit --error-tracking interactively and detects an array-form plugin', async () => {
    const command = createCommand(['--error-tracking', '--posthog-cli-api-key', 'phx_flag']);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { name: 'testapp', slug: 'testapp', plugins: [['expo-router', {}]] },
        projectDir: '/test/project',
      },
      loggedIn: { graphqlClient, actor: mockActor },
    } as never);

    await command.runAsync();

    expect(promptAsync).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'features' }));
    const cliKeyVar = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.find(call => call[1].name === 'POSTHOG_CLI_API_KEY');
    expect(cliKeyVar?.[1].value).toBe('phx_flag');
    expect(createOrModifyExpoConfigAsync).toHaveBeenCalled();
  });

  it('skips an existing EAS environment variable non-interactively without --overwrite', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      .mockResolvedValue([{ id: 'existing-1', scope: EnvironmentVariableScope.Project }] as any);

    await createCommand(['--non-interactive', '--region', 'US']).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('pass --overwrite to replace it')
    );
  });

  it('skips an existing EAS environment variable when overwrite is declined', async () => {
    mockFeatureSelection(['analytics']);
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      .mockResolvedValue([{ id: 'existing-1', scope: EnvironmentVariableScope.Project }] as any);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand([]).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipped updating EAS environment variable')
    );
  });
});
