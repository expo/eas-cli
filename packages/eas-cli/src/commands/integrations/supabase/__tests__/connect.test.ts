import spawnAsync from '@expo/spawn-async';
import openBrowserAsync from 'better-opn';
import * as fs from 'fs-extra';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import * as supabaseCommandUtils from '../../../../commandUtils/supabase';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
  Role,
} from '../../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../../graphql/mutations/EnvironmentVariableMutation';
import { SupabaseMutation } from '../../../../graphql/mutations/SupabaseMutation';
import { EnvironmentVariablesQuery } from '../../../../graphql/queries/EnvironmentVariablesQuery';
import { SupabaseQuery } from '../../../../graphql/queries/SupabaseQuery';
import {
  SupabaseConnectionData,
  SupabaseOrganizationData,
  SupabaseProjectData,
} from '../../../../graphql/types/SupabaseConnection';
import Log from '../../../../log';
import { createOrModifyExpoConfigAsync } from '../../../../project/expoConfig';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../../../prompts';
import { printJsonOnlyOutput } from '../../../../utils/json';
import {
  BackgroundJobReceiptPollError,
  BackgroundJobReceiptPollErrorType,
  pollForBackgroundJobReceiptAsync,
} from '../../../../utils/pollForBackgroundJobReceiptAsync';
import IntegrationsSupabaseConnect from '../connect';

jest.mock('@expo/spawn-async');
jest.mock('better-opn');
jest.mock('fs-extra');
jest.mock('../../../../project/expoConfig');
jest.mock('../../../../graphql/queries/SupabaseQuery');
jest.mock('../../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../../graphql/mutations/SupabaseMutation');
jest.mock('../../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../../project/projectUtils');
jest.mock('../../../../prompts');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../utils/pollForBackgroundJobReceiptAsync', () => ({
  ...jest.requireActual('../../../../utils/pollForBackgroundJobReceiptAsync'),
  pollForBackgroundJobReceiptAsync: jest.fn(),
}));
jest.mock('../../../../ora', () => ({
  ora: () => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    text: '',
  }),
}));

describe(IntegrationsSupabaseConnect, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const testAccountId = 'test-account-id';
  const testAccountName = 'testuser';

  const mockAccount = {
    id: testAccountId,
    name: testAccountName,
    ownerUserActor: { id: 'test-user-id', username: testAccountName },
    users: [{ role: Role.Owner, actor: { id: 'test-user-id' } }],
  };

  const mockConnection: SupabaseConnectionData = {
    id: 'connection-1',
    supabaseOrganizationSlug: 'org-slug',
    supabaseOrganizationName: 'Primary Org',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockOrganizations: SupabaseOrganizationData[] = [
    { id: 'org-1', slug: 'org-slug', name: 'Primary Org' },
    { id: 'org-2', slug: 'other-org', name: 'Other Org' },
  ];

  const mockProject: SupabaseProjectData = {
    id: 'project-1',
    supabaseProjectRef: 'abcdefghijklmnop',
    supabaseProjectName: 'Test App',
    supabaseProjectUrl: 'https://abcdefghijklmnop.supabase.co',
    supabaseRegion: 'us-east-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  function createCommand(argv: string[]): IntegrationsSupabaseConnect {
    const command = new IntegrationsSupabaseConnect(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { name: 'testapp', slug: 'testapp', plugins: [] },
        projectDir: '/test/project',
      },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'error').mockImplementation(() => {});
    jest.spyOn(Log, 'withTick').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});
    jest.spyOn(Log, 'debug').mockImplementation(() => {});

    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockAccount as any);
    jest.mocked(selectAsync).mockResolvedValue('americas');
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(promptAsync).mockResolvedValue({ linkValue: mockProject.supabaseProjectRef });
    jest.mocked(spawnAsync).mockResolvedValue({} as any);
    jest.mocked(fs.pathExists).mockResolvedValue(false as never);
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({ type: 'success' } as any);
    jest.mocked(openBrowserAsync).mockResolvedValue(true as never);
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]);
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(['production', 'preview', 'development']);
    jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockResolvedValue({
      id: 'env-var-1',
      scope: EnvironmentVariableScope.Project,
    } as any);
    jest
      .mocked(EnvironmentVariableMutation.updateAsync)
      .mockResolvedValue({ id: 'env-var-1' } as any);
    jest.mocked(EnvironmentVariableMutation.deleteAsync).mockResolvedValue({ id: 'env-var-extra' });

    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockResolvedValue(mockConnection);
    jest
      .mocked(SupabaseMutation.listSupabaseOrganizationsAsync)
      .mockResolvedValue(mockOrganizations);
    jest
      .mocked(SupabaseMutation.fetchSupabasePublishableKeyAsync)
      .mockResolvedValue('sb_publishable_test');
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(mockProject);
    jest.mocked(SupabaseMutation.linkSupabaseProjectAsync).mockResolvedValue(mockProject);
    jest.mocked(SupabaseMutation.provisionSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-1',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-1',
      resultData: { supabaseProjectRef: mockProject.supabaseProjectRef },
    } as any);
  });

  it('reuses an existing connection and project and writes public env vars', async () => {
    await createCommand([]).runAsync();

    expect(SupabaseMutation.beginSupabaseOAuthAsync).not.toHaveBeenCalled();
    expect(SupabaseMutation.provisionSupabaseProjectAsync).not.toHaveBeenCalled();
    expect(spawnAsync).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['expo', 'install', '@supabase/supabase-js', 'expo-sqlite']),
      expect.objectContaining({
        cwd: '/test/project',
      })
    );
    expect(createOrModifyExpoConfigAsync).toHaveBeenCalled();
    const createdNames = jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.map(call => call[1].name);
    expect(createdNames).toEqual([
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ]);
    expect(
      jest.mocked(EnvironmentVariableMutation.createForAppAsync).mock.calls[0][1].visibility
    ).toBe(EnvironmentVariableVisibility.Public);
  });

  it('loads organizations once when formatting the existing connection label', async () => {
    await createCommand([]).runAsync();

    expect(SupabaseMutation.listSupabaseOrganizationsAsync).toHaveBeenCalledTimes(1);
  });

  it('formats the connection when organization listing fails', async () => {
    jest
      .mocked(SupabaseMutation.listSupabaseOrganizationsAsync)
      .mockRejectedValue(new Error('skip'));

    await createCommand(['--overwrite']).runAsync();

    expect(Log.withTick).toHaveBeenCalledWith(expect.stringContaining('Primary Org'));
  });

  it('strips EXPO_LOCAL / EXPO_STAGING / EXPO_UNIVERSE_DIR from the expo install env', async () => {
    const previous = {
      EXPO_LOCAL: process.env.EXPO_LOCAL,
      EXPO_STAGING: process.env.EXPO_STAGING,
      EXPO_UNIVERSE_DIR: process.env.EXPO_UNIVERSE_DIR,
    };
    process.env.EXPO_LOCAL = '1';
    process.env.EXPO_STAGING = '1';
    process.env.EXPO_UNIVERSE_DIR = '/tmp/universe';
    try {
      await createCommand([]).runAsync();
      const spawnOptions = jest.mocked(spawnAsync).mock.calls[0]?.[2] as {
        env?: NodeJS.ProcessEnv;
      };
      expect(spawnOptions.env?.EXPO_LOCAL).toBeUndefined();
      expect(spawnOptions.env?.EXPO_STAGING).toBeUndefined();
      expect(spawnOptions.env?.EXPO_UNIVERSE_DIR).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('links an existing project and skips provisioning', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(SupabaseMutation.linkSupabaseProjectAsync).mockResolvedValue(mockProject);

    await createCommand(['--link', mockProject.supabaseProjectRef]).runAsync();

    expect(SupabaseMutation.linkSupabaseProjectAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      supabaseProjectRef: mockProject.supabaseProjectRef,
    });
    expect(SupabaseMutation.provisionSupabaseProjectAsync).not.toHaveBeenCalled();
    expect(SupabaseMutation.fetchSupabasePublishableKeyAsync).toHaveBeenCalled();
    expect(SupabaseQuery.getSupabaseProjectByAppIdAsync).toHaveBeenCalledTimes(1);
  });

  it('provisions via background receipt when no project is linked', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockProject);

    await createCommand(['--region', 'americas', '--organization', 'org-slug']).runAsync();

    expect(SupabaseMutation.provisionSupabaseProjectAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      region: 'americas',
    });
    expect(pollForBackgroundJobReceiptAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.anything(),
      expect.objectContaining({
        maxChecks: 420,
        maxConsecutiveFetchErrors: 3,
      })
    );
  });

  it('surfaces a permanent provision failure with a --link hint', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockRejectedValue(
      new BackgroundJobReceiptPollError({
        errorType: BackgroundJobReceiptPollErrorType.JOB_FAILED_NO_WILL_RETRY,
        receiptErrorMessage: 'name already taken',
      })
    );

    await expect(
      createCommand(['--region', 'americas', '--organization', 'org-slug']).runAsync()
    ).rejects.toThrow(/name already taken[\s\S]*--link/);
  });

  it('maps NULL_RECEIPT poll errors to a recoverable timeout hint', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockRejectedValue(
      new BackgroundJobReceiptPollError({
        errorType: BackgroundJobReceiptPollErrorType.NULL_RECEIPT,
      })
    );

    await expect(
      createCommand(['--region', 'americas', '--organization', 'org-slug']).runAsync()
    ).rejects.toThrow(/Timed out or lost contact[\s\S]*--link/);
  });

  it('switches organization when --organization differs from the connection', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockProject);
    jest.mocked(SupabaseMutation.setSupabaseConnectionOrganizationAsync).mockResolvedValue({
      ...mockConnection,
      supabaseOrganizationSlug: 'other-org',
      supabaseOrganizationName: 'Other Org',
    });

    await createCommand(['--region', 'americas', '--organization', 'other-org']).runAsync();

    expect(SupabaseMutation.setSupabaseConnectionOrganizationAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        supabaseConnectionId: mockConnection.id,
        organizationSlug: 'other-org',
      }
    );
  });

  it('resets the connection with --reauth, then links an existing project by default', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockResolvedValueOnce(mockConnection)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(mockConnection);
    // Cascade delete removes the EAS project link with the connection.
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      state: 'state',
      url: 'https://api.supabase.com/v1/oauth/authorize',
    });
    jest.mocked(SupabaseMutation.disconnectSupabaseAsync).mockResolvedValue(mockConnection.id);
    jest
      .mocked(selectAsync)
      .mockResolvedValueOnce('link')
      .mockResolvedValue('americas');
    jest.mocked(promptAsync).mockResolvedValue({ linkValue: mockProject.supabaseProjectRef });
    jest.mocked(SupabaseMutation.linkSupabaseProjectAsync).mockResolvedValue(mockProject);

    await createCommand(['--reauth']).runAsync();

    expect(SupabaseMutation.disconnectSupabaseAsync).toHaveBeenCalledWith(
      graphqlClient,
      mockConnection.id
    );
    expect(SupabaseMutation.beginSupabaseOAuthAsync).toHaveBeenCalled();
    expect(openBrowserAsync).toHaveBeenCalled();
    expect(selectAsync).toHaveBeenCalledWith(
      expect.stringContaining('previous EAS project link was removed'),
      expect.arrayContaining([
        expect.objectContaining({ value: 'link' }),
        expect.objectContaining({ value: 'provision' }),
      ]),
      expect.objectContaining({ initial: 'link' })
    );
    const promptOpts = jest.mocked(promptAsync).mock.calls[0]?.[0] as {
      validate?: (value: string) => true | string;
    };
    expect(promptOpts.validate?.(mockProject.supabaseProjectRef)).toBe(true);
    expect(promptOpts.validate?.('not a ref')).toEqual(expect.any(String));
    const parseSpy = jest
      .spyOn(supabaseCommandUtils, 'parseSupabaseProjectRef')
      .mockImplementationOnce(() => {
        throw 'nope';
      });
    expect(promptOpts.validate?.('x')).toBe('Invalid project ref or URL');
    parseSpy.mockRestore();
    expect(SupabaseMutation.linkSupabaseProjectAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      supabaseProjectRef: mockProject.supabaseProjectRef,
    });
    expect(SupabaseMutation.provisionSupabaseProjectAsync).not.toHaveBeenCalled();
  });

  it('provisions after --reauth when the user chooses provision', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockResolvedValueOnce(mockConnection)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(mockConnection);
    jest
      .mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(mockProject);
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      state: 'state',
      url: 'https://api.supabase.com/v1/oauth/authorize',
    });
    jest.mocked(SupabaseMutation.disconnectSupabaseAsync).mockResolvedValue(mockConnection.id);
    jest
      .mocked(selectAsync)
      .mockResolvedValueOnce('provision')
      .mockResolvedValueOnce('org-slug')
      .mockResolvedValue('americas');

    await createCommand(['--reauth']).runAsync();

    expect(SupabaseMutation.provisionSupabaseProjectAsync).toHaveBeenCalled();
    expect(SupabaseMutation.linkSupabaseProjectAsync).not.toHaveBeenCalled();
  });

  it('skips the post-reauth prompt when --link is passed', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockResolvedValueOnce(mockConnection)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(mockConnection);
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      state: 'state',
      url: 'https://api.supabase.com/v1/oauth/authorize',
    });
    jest.mocked(SupabaseMutation.disconnectSupabaseAsync).mockResolvedValue(mockConnection.id);
    jest.mocked(SupabaseMutation.linkSupabaseProjectAsync).mockResolvedValue(mockProject);

    await createCommand(['--reauth', '--link', mockProject.supabaseProjectRef]).runAsync();

    expect(SupabaseMutation.linkSupabaseProjectAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      supabaseProjectRef: mockProject.supabaseProjectRef,
    });
    expect(SupabaseMutation.provisionSupabaseProjectAsync).not.toHaveBeenCalled();
    expect(selectAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('previous EAS project link was removed'),
      expect.anything(),
      expect.anything()
    );
  });

  it('rejects --reauth in non-interactive mode when a connection exists', async () => {
    await expect(createCommand(['--reauth', '--non-interactive']).runAsync()).rejects.toThrow(
      /non-interactive/
    );
    expect(SupabaseMutation.disconnectSupabaseAsync).not.toHaveBeenCalled();
  });

  it('ignores --reauth when there is no connection', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(mockConnection);
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      state: 'state',
      url: 'https://api.supabase.com/v1/oauth/authorize',
    });

    await createCommand(['--reauth']).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('--reauth ignored'));
    expect(SupabaseMutation.disconnectSupabaseAsync).not.toHaveBeenCalled();
  });

  it('prints json output for an already-connected project', async () => {
    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ ref: mockProject.supabaseProjectRef }),
        envLocalWritten: true,
        manualSteps: [],
      })
    );
  });

  it('requires --region in non-interactive mode when provisioning', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);

    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(/--region/);
  });

  it('provisions an additional project for --environment preview', async () => {
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-additional',
      resultData: {
        supabaseProjectRef: 'previewref123456',
        supabaseProjectUrl: 'https://previewref123456.supabase.co',
        supabaseRegion: 'us-east-1',
        publishableKey: 'sb_publishable_preview',
      },
    } as any);

    await createCommand([
      '--environment',
      'preview',
      '--region',
      'americas',
      '--overwrite',
    ]).runAsync();

    expect(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        appId: testProjectId,
        region: 'americas',
        projectNameSuffix: 'preview',
      })
    );
    expect(SupabaseMutation.provisionSupabaseProjectAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        name: 'EXPO_PUBLIC_SUPABASE_URL',
        value: 'https://previewref123456.supabase.co',
        environments: ['preview'],
      }),
      testProjectId
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('surfaces additional provision failures with --link guidance', async () => {
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockRejectedValue(
      new BackgroundJobReceiptPollError({
        errorType: BackgroundJobReceiptPollErrorType.JOB_FAILED_NO_WILL_RETRY,
        receiptErrorMessage: 'maximum limits for the number of active free projects',
      })
    );

    await expect(
      createCommand(['--environment', 'preview', '--region', 'americas', '--overwrite']).runAsync()
    ).rejects.toThrow(
      /maximum limits for the number of active free projects[\s\S]*--environment preview(?!.*--link)/
    );
  });

  it('peels preview off the primary env var when adding --environment preview', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'primary-url',
        name: 'EXPO_PUBLIC_SUPABASE_URL',
        value: 'https://primary.supabase.co',
        scope: EnvironmentVariableScope.Project,
        environments: ['production', 'preview', 'development'],
      },
      {
        id: 'primary-key',
        name: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        value: 'sb_publishable_primary',
        scope: EnvironmentVariableScope.Project,
        environments: ['production', 'preview', 'development'],
      },
    ] as any);
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-additional',
      resultData: {
        supabaseProjectRef: 'previewref123456',
        supabaseProjectUrl: 'https://previewref123456.supabase.co',
        supabaseRegion: 'us-east-1',
        publishableKey: 'sb_publishable_preview',
      },
    } as any);

    await createCommand([
      '--environment',
      'preview',
      '--region',
      'americas',
      '--overwrite',
    ]).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        id: 'primary-url',
        environments: ['production', 'development'],
      })
    );
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        name: 'EXPO_PUBLIC_SUPABASE_URL',
        value: 'https://previewref123456.supabase.co',
        environments: ['preview'],
      }),
      testProjectId
    );
  });

  it('rejects empty --environment', async () => {
    await expect(createCommand(['--environment', '  ']).runAsync()).rejects.toThrow(
      /at least one EAS environment/
    );
  });

  it('rejects unknown --environment in non-interactive mode', async () => {
    await expect(
      createCommand([
        '--environment',
        'prevew',
        '--region',
        'americas',
        '--non-interactive',
      ]).runAsync()
    ).rejects.toThrow(/EAS environment\(s\) not found/);
  });

  it('proceeds with unknown --environment after confirmation', async () => {
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-additional',
      resultData: {
        supabaseProjectRef: 'stagingref123456',
        supabaseProjectUrl: 'https://stagingref123456.supabase.co',
        supabaseRegion: 'us-east-1',
        publishableKey: 'sb_publishable_staging',
      },
    } as any);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await createCommand(['--environment', 'staging', '--region', 'americas']).runAsync();

    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(
          /EAS environment "staging" is not used on this project yet.*Continue provisioning\?/i
        ),
      })
    );
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        name: 'EXPO_PUBLIC_SUPABASE_URL',
        environments: ['staging'],
      }),
      testProjectId
    );
  });

  it('aborts when declining to create an unknown --environment', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      createCommand(['--environment', 'staging', '--region', 'americas']).runAsync()
    ).rejects.toThrow(/Canceled\. No additional Supabase project was provisioned/);
    expect(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).not.toHaveBeenCalled();
  });

  it('rejects --environment with --link', async () => {
    await expect(
      createCommand(['--environment', 'preview', '--link', 'abcdefghijklmnop']).runAsync()
    ).rejects.toThrow(/Cannot combine --environment with --link/);
  });

  it('reconciles split env vars on a plain reconnect', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'primary-url',
        name: 'EXPO_PUBLIC_SUPABASE_URL',
        value: 'https://primary.supabase.co',
        scope: EnvironmentVariableScope.Project,
        environments: ['production', 'development'],
      },
      {
        id: 'preview-url',
        name: 'EXPO_PUBLIC_SUPABASE_URL',
        value: 'https://preview.supabase.co',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
      },
    ] as any);

    await createCommand(['--overwrite']).runAsync();

    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(
      graphqlClient,
      'preview-url'
    );
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        id: 'primary-url',
        value: mockProject.supabaseProjectUrl,
        environments: ['production', 'preview', 'development'],
      })
    );
  });

  it('rejects --environment in non-interactive mode when env vars would be skipped', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'primary-url',
        name: 'EXPO_PUBLIC_SUPABASE_URL',
        value: 'https://primary.supabase.co',
        scope: EnvironmentVariableScope.Project,
        environments: ['production', 'preview', 'development'],
      },
    ] as any);

    await expect(
      createCommand([
        '--environment',
        'preview',
        '--region',
        'americas',
        '--non-interactive',
      ]).runAsync()
    ).rejects.toThrow(/--overwrite/);
    expect(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).not.toHaveBeenCalled();
  });

  it('rejects --environment without a primary project', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);

    await expect(
      createCommand(['--environment', 'preview', '--region', 'americas']).runAsync()
    ).rejects.toThrow(/without --environment first/);
  });

  it('continues and still writes env vars when SDK installation fails', async () => {
    jest.mocked(spawnAsync).mockRejectedValue(new Error('npm exploded'));

    await createCommand(['--overwrite']).runAsync();

    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('npx expo install'));
  });

  it('on a dynamic config, shows Expo install guidance and skips a second plugin rewrite', async () => {
    const expoGuidance = [
      'Cannot automatically write to dynamic config at: app.config.js',
      'Add the following to your Expo config',
      '',
      '{',
      '  "plugins": [',
      '    "expo-sqlite"',
      '  ]',
      '}',
    ].join('\n');
    jest.mocked(spawnAsync).mockRejectedValue(
      Object.assign(new Error('Process exited with non-zero code: 1'), {
        stdout: `${expoGuidance}\n`,
        stderr: '',
      })
    );

    await createCommand(['--overwrite']).runAsync();

    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalled();
    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cannot automatically write to dynamic config at: app.config.js')
    );
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('"expo-sqlite"'));
    expect(Log.warn).not.toHaveBeenCalledWith(expect.stringContaining("didn't install"));
  });

  it('rejects --environment with --reauth', async () => {
    await expect(
      createCommand(['--environment', 'preview', '--reauth']).runAsync()
    ).rejects.toThrow(/Cannot combine --environment with --reauth/);
  });

  it('warns when --link differs from an already linked project', async () => {
    await createCommand(['--link', 'differentref12345', '--overwrite']).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring --link'));
    expect(SupabaseMutation.linkSupabaseProjectAsync).not.toHaveBeenCalled();
  });

  it('warns when --region is passed for an already linked project', async () => {
    await createCommand(['--region', 'emea', '--overwrite']).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring --region/--organization')
    );
  });

  it('throws when primary provision succeeds without a project link', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-1',
      resultData: { supabaseProjectRef: 'newref1234567890' },
    } as any);

    await expect(createCommand(['--region', 'americas', '--overwrite']).runAsync()).rejects.toThrow(
      /link with --link newref1234567890/
    );
  });

  it('throws when primary provision succeeds without a project ref in the receipt', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-1',
      resultData: {},
    } as any);

    await expect(createCommand(['--region', 'americas', '--overwrite']).runAsync()).rejects.toThrow(
      /Provision succeeded but the Expo project link was not found/
    );
  });

  it('throws when primary provision receipt data is not an object', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-1',
      resultData: 'not-an-object',
    } as any);

    await expect(createCommand(['--region', 'americas', '--overwrite']).runAsync()).rejects.toThrow(
      /Provision succeeded but the Expo project link was not found/
    );
  });

  it('rejects --environment without a connection', async () => {
    jest.mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync).mockResolvedValue(null);

    await expect(
      createCommand(['--environment', 'preview', '--region', 'americas']).runAsync()
    ).rejects.toThrow(/No Supabase connection found/);
  });

  it('rejects --organization with --environment', async () => {
    await expect(
      createCommand([
        '--environment',
        'preview',
        '--region',
        'americas',
        '--organization',
        'other-org',
        '--overwrite',
      ]).runAsync()
    ).rejects.toThrow(/Cannot use --organization with --environment/);
  });

  it('throws when additional provision omits credentials', async () => {
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-additional',
      resultData: { supabaseProjectRef: 'previewref123456' },
    } as any);

    await expect(
      createCommand(['--environment', 'preview', '--region', 'americas', '--overwrite']).runAsync()
    ).rejects.toThrow(
      /did not return project credentials[\s\S]*Do not re-run connect --environment/
    );
  });

  it('throws when additional env writes partially skip', async () => {
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-additional',
      resultData: {
        supabaseProjectRef: 'previewref123456',
        supabaseProjectUrl: 'https://previewref123456.supabase.co',
        supabaseRegion: 'us-east-1',
        publishableKey: 'sb_publishable_preview',
      },
    } as any);
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      .mockResolvedValueOnce([]) // ensure: URL
      .mockResolvedValueOnce([]) // ensure: KEY
      .mockResolvedValueOnce([]) // upsert URL: create
      .mockResolvedValueOnce([
        {
          id: 'existing-key',
          name: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
          value: 'different',
          scope: EnvironmentVariableScope.Project,
          environments: ['preview'],
        },
      ] as any); // upsert KEY: exact match
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      createCommand(['--environment', 'preview', '--region', 'americas']).runAsync()
    ).rejects.toThrow(
      /did not write all EAS environment variables[\s\S]*Do not re-run connect --environment[\s\S]*sb_publishable_preview/
    );
  });

  it('prints json for additional environment setup', async () => {
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-additional',
      resultData: {
        supabaseProjectRef: 'previewref123456',
        supabaseProjectUrl: 'https://previewref123456.supabase.co',
        publishableKey: 'sb_publishable_preview',
      },
    } as any);
    jest
      .mocked(SupabaseMutation.listSupabaseOrganizationsAsync)
      .mockRejectedValue(new Error('skip'));

    await createCommand([
      '--environment',
      'preview',
      '--region',
      'americas',
      '--overwrite',
      '--json',
    ]).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalProject: expect.objectContaining({
          ref: 'previewref123456',
          region: 'americas',
        }),
        environments: ['preview'],
      })
    );
  });

  it('wraps env write failures after additional provision', async () => {
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-additional',
      resultData: {
        supabaseProjectRef: 'previewref123456',
        supabaseProjectUrl: 'https://previewref123456.supabase.co',
        supabaseRegion: 'us-east-1',
        publishableKey: 'sb_publishable_preview',
      },
    } as any);
    jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mockRejectedValue(new Error('graphql down'));

    await expect(
      createCommand(['--environment', 'preview', '--region', 'americas', '--overwrite']).runAsync()
    ).rejects.toThrow(
      /could not write EAS environment variables.*graphql down[\s\S]*Do not re-run connect --environment[\s\S]*EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_preview/
    );
  });

  it('wraps non-Error env write failures after additional provision', async () => {
    jest.mocked(SupabaseMutation.provisionAdditionalSupabaseProjectAsync).mockResolvedValue({
      id: 'receipt-additional',
    } as any);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue({
      id: 'receipt-additional',
      resultData: {
        supabaseProjectRef: 'previewref123456',
        supabaseProjectUrl: 'https://previewref123456.supabase.co',
        supabaseRegion: 'us-east-1',
        publishableKey: 'sb_publishable_preview',
      },
    } as any);
    jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockRejectedValue('graphql down');

    await expect(
      createCommand(['--environment', 'preview', '--region', 'americas', '--overwrite']).runAsync()
    ).rejects.toThrow(
      /could not write EAS environment variables.*graphql down[\s\S]*Do not re-run connect --environment/
    );
  });
});
