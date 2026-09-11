import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';
import stripAnsi from 'strip-ansi';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../../../../commandUtils/errors';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { SupabaseMutation } from '../../../../graphql/mutations/SupabaseMutation';
import { SupabaseQuery } from '../../../../graphql/queries/SupabaseQuery';
import {
  SupabaseAdvisorLintData,
  SupabaseAdvisorLintLevel,
  SupabaseAdvisorLintsData,
  SupabaseAdvisorType,
} from '../../../../graphql/types/SupabaseConnection';
import { authorizeViaBrowserAsync } from '../../../../integrations/supabase/provision';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsSupabaseAdvisors from '../advisors';

jest.mock('../../../../graphql/queries/SupabaseQuery');
jest.mock('../../../../graphql/mutations/SupabaseMutation');
jest.mock('../../../../log', () => {
  const actual = jest.requireActual('../../../../log');
  return {
    __esModule: true,
    ...actual,
    default: { ...actual.default, log: jest.fn(), warn: jest.fn(), newLine: jest.fn() },
  };
});
jest.mock('../../../../utils/json');
jest.mock('../../../../prompts');
jest.mock('../../../../integrations/supabase/provision');
jest.mock('../../../../project/projectUtils');
jest.mock('../../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
  })),
}));

describe(IntegrationsSupabaseAdvisors, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const runCommand = jest.fn();
  Object.assign(mockConfig, { runCommand });

  const rlsLint: SupabaseAdvisorLintData = {
    name: 'rls_disabled_in_public',
    title: 'RLS Disabled in Public',
    level: SupabaseAdvisorLintLevel.Error,
    description: 'Detects cases where row level security (RLS) has not been enabled on a table.',
    detail: 'Table \\`public.todos\\` is public, but RLS has not been enabled.',
    entity: 'public.todos',
    remediation: 'https://supabase.com/docs/guides/database/database-linter?lint=0013',
    cacheKey: 'rls_disabled_in_public_public_todos',
  };
  const unindexedForeignKeyLint: SupabaseAdvisorLintData = {
    name: 'unindexed_foreign_keys',
    title: 'Unindexed foreign keys',
    level: SupabaseAdvisorLintLevel.Info,
    description: 'Identifies foreign key constraints without a covering index.',
    detail: 'Table `public.todos` has a foreign key without a covering index.',
    entity: 'public.todos',
    remediation: null,
    cacheKey: 'unindexed_foreign_keys_public_todos',
  };
  const mockResult: SupabaseAdvisorLintsData = {
    project: {
      id: 'project-1',
      supabaseProjectRef: 'abcdefghijklmnop',
      supabaseProjectName: 'Test App',
      supabaseProjectUrl: 'https://abcdefghijklmnop.supabase.co',
      supabaseRegion: 'us-east-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    security: [rlsLint],
    performance: [unindexedForeignKeyLint],
  };

  function createCommand(argv: string[]): IntegrationsSupabaseAdvisors {
    const command = new IntegrationsSupabaseAdvisors(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { slug: 'testapp' },
      },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  function loggedOutput(): string {
    return jest
      .mocked(Log.log)
      .mock.calls.map(([line]) => stripAnsi(String(line)))
      .join('\n');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(authorizeViaBrowserAsync)
      .mockResolvedValue({ supabaseOrganizationSlug: 'original-org' } as never);
    jest
      .mocked(getOwnerAccountForProjectIdAsync)
      .mockResolvedValue({ id: 'account-1', name: 'test' } as never);
    jest.mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync).mockResolvedValue({
      updatedAt: '2024-01-01',
      supabaseOrganizationSlug: 'original-org',
    } as never);
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(mockResult.project);
    jest.mocked(SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync).mockResolvedValue(mockResult);
  });

  function mockReauthorizationRequiredOnce(): void {
    jest.mocked(SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync).mockRejectedValueOnce(
      new CombinedError({
        graphQLErrors: [
          new GraphQLError('Expo is not allowed to read this Supabase project’s advisors.', {
            extensions: { errorCode: 'SUPABASE_REAUTHORIZATION_REQUIRED_ERROR', errorType: 'USER' },
          }),
        ],
      })
    );
  }

  it('prints both advisors with severity summaries, details, and dashboard links', async () => {
    await createCommand([]).runAsync();

    expect(SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync).toHaveBeenCalledWith(
      graphqlClient,
      testProjectId,
      [SupabaseAdvisorType.Security, SupabaseAdvisorType.Performance]
    );
    const output = loggedOutput();
    expect(output).toContain('Security: 1 error');
    expect(output).toContain('RLS Disabled in Public');
    expect(output).toContain('Table public.todos is public, but RLS has not been enabled.');
    expect(output).toContain('https://supabase.com/docs/guides/database/database-linter?lint=0013');
    expect(output).toContain(
      'https://supabase.com/dashboard/project/abcdefghijklmnop/advisors/security?id=rls_disabled_in_public_public_todos'
    );
    expect(output).toContain('Performance: 1 suggestion');
    expect(output).toContain(
      'https://supabase.com/dashboard/project/abcdefghijklmnop/advisors/performance'
    );
  });

  it('limits the output to one advisor with --type', async () => {
    await createCommand(['--type', 'security']).runAsync();

    const output = loggedOutput();
    expect(output).toContain('Security: 1 error');
    expect(output).not.toContain('Performance');
    expect(SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync).toHaveBeenCalledWith(
      graphqlClient,
      testProjectId,
      [SupabaseAdvisorType.Security]
    );
  });

  it('prints structured findings with --json', async () => {
    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      project: {
        ref: 'abcdefghijklmnop',
        name: 'Test App',
        dashboardUrls: {
          security: 'https://supabase.com/dashboard/project/abcdefghijklmnop/advisors/security',
          performance:
            'https://supabase.com/dashboard/project/abcdefghijklmnop/advisors/performance',
        },
      },
      security: [rlsLint],
      performance: [unindexedForeignKeyLint],
    });
    expect(Log.log).not.toHaveBeenCalled();
  });

  it('warns when no Supabase project is linked', async () => {
    jest.mocked(SupabaseQuery.getSupabaseProjectByAppIdAsync).mockResolvedValue(null);

    await createCommand([]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('No Supabase project'));
  });

  it('offers to re-authorize, refreshes OAuth in place, and retries when accepted', async () => {
    mockReauthorizationRequiredOnce();
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await createCommand([]).runAsync();

    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Re-authorize Supabase') })
    );
    expect(authorizeViaBrowserAsync).toHaveBeenCalledWith(
      graphqlClient,
      { id: 'account-1', name: 'test' },
      false,
      '2024-01-01'
    );
    expect(runCommand).not.toHaveBeenCalled();
    expect(SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync).toHaveBeenCalledTimes(2);
    expect(loggedOutput()).toContain('Security: 1 error');
  });

  it('preserves the selected organization when OAuth defaults to a different one', async () => {
    mockReauthorizationRequiredOnce();
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest
      .mocked(authorizeViaBrowserAsync)
      .mockResolvedValue({ id: 'connection-1', supabaseOrganizationSlug: 'other-org' } as never);
    await createCommand([]).runAsync();
    expect(SupabaseMutation.setSupabaseConnectionOrganizationAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        supabaseConnectionId: 'connection-1',
        organizationSlug: 'original-org',
      }
    );
  });

  it('stops with the reauth command when the user declines to re-authorize', async () => {
    mockReauthorizationRequiredOnce();
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(createCommand([]).runAsync()).rejects.toThrow(
      'eas integrations:supabase:advisors'
    );
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('fails with the reauth command in non-interactive mode', async () => {
    mockReauthorizationRequiredOnce();

    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(EasCommandError);
    expect(confirmAsync).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });
  it('distinguishes unavailable advisors from clean results', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync)
      .mockResolvedValue({ ...mockResult, security: null, performance: [] });
    await createCommand([]).runAsync();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Security advisors are unavailable')
    );
    expect(loggedOutput()).toContain('Performance: no unresolved findings');
    expect(loggedOutput()).not.toContain('Security: no unresolved findings');
  });

  it('does not reauthorize when the project is unlinked during the request', async () => {
    jest.mocked(SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync).mockResolvedValue(null);
    await createCommand(['--json']).runAsync();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      project: null,
      security: null,
      performance: null,
    });
    expect(confirmAsync).not.toHaveBeenCalled();
    expect(authorizeViaBrowserAsync).not.toHaveBeenCalled();
  });
});
