import { DefaultEnvironment } from '../../../build/utils/environment';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import { confirmAsync } from '../../../prompts';
import {
  EAS_SUPABASE_ENVIRONMENTS,
  EAS_SUPABASE_PUBLISHABLE_KEY_ENV_VAR_NAME,
  EAS_SUPABASE_URL_ENV_VAR_NAME,
  confirmOverwriteForAdditionalProjectAsync,
  createSupabaseEnvVars,
  supabaseEnvironmentCancelMessage,
  supabaseMoveConfirmMessage,
} from '../env';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../prompts');
jest.mock('../../../log');

describe('createSupabaseEnvVars and constants', () => {
  it('returns public URL and key vars', () => {
    expect(createSupabaseEnvVars('https://example.supabase.co', 'pk')).toEqual([
      {
        name: EAS_SUPABASE_URL_ENV_VAR_NAME,
        value: 'https://example.supabase.co',
        visibility: EnvironmentVariableVisibility.Public,
      },
      {
        name: EAS_SUPABASE_PUBLISHABLE_KEY_ENV_VAR_NAME,
        value: 'pk',
        visibility: EnvironmentVariableVisibility.Public,
      },
    ]);
  });

  it('lists production, preview, and development in that order', () => {
    expect(EAS_SUPABASE_ENVIRONMENTS).toEqual([
      DefaultEnvironment.Production,
      DefaultEnvironment.Preview,
      DefaultEnvironment.Development,
    ]);
  });
});

describe('Supabase prompt messages', () => {
  it('names the additional project when moving a variable', () => {
    expect(supabaseMoveConfirmMessage(EAS_SUPABASE_URL_ENV_VAR_NAME, 'preview')).toBe(
      `Move ${EAS_SUPABASE_URL_ENV_VAR_NAME} for preview to the additional Supabase project?`
    );
  });

  it('lists known environments when provisioning is canceled', () => {
    expect(supabaseEnvironmentCancelMessage('production, preview')).toContain(
      'No additional Supabase project was provisioned'
    );
    expect(supabaseEnvironmentCancelMessage('production, preview')).toContain(
      'known: production, preview'
    );
  });
});

describe('confirmOverwriteForAdditionalProjectAsync', () => {
  const client = {} as ExpoGraphqlClient;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('forces overwrite immediately with overwrite', async () => {
    await expect(
      confirmOverwriteForAdditionalProjectAsync(client, 'app-1', ['preview'], true, true)
    ).resolves.toEqual({ forceOverwrite: true });
    expect(EnvironmentVariablesQuery.byAppIdAsync).not.toHaveBeenCalled();
  });

  it('does not force overwrite when there is no overlap', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]);
    await expect(
      confirmOverwriteForAdditionalProjectAsync(client, 'app-1', ['preview'], true, false)
    ).resolves.toEqual({ forceOverwrite: false });
  });

  it('treats null environments as no overlap', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'v1',
        scope: EnvironmentVariableScope.Project,
        environments: null,
      } as never,
    ]);
    await expect(
      confirmOverwriteForAdditionalProjectAsync(client, 'app-1', ['preview'], true, false)
    ).resolves.toEqual({ forceOverwrite: false });
  });

  it('throws in non-interactive mode when overlap exists', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'v1',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
      } as never,
    ]);

    await expect(
      confirmOverwriteForAdditionalProjectAsync(client, 'app-1', ['preview'], true, false)
    ).rejects.toThrow(/Re-run with --overwrite/);
  });

  it('forces overwrite after interactive confirmation', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'v1',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
      } as never,
    ]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      confirmOverwriteForAdditionalProjectAsync(client, 'app-1', ['preview'], false, false)
    ).resolves.toEqual({ forceOverwrite: true });
  });

  it('throws when interactive confirmation is declined', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'v1',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
      } as never,
    ]);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      confirmOverwriteForAdditionalProjectAsync(client, 'app-1', ['preview'], false, false)
    ).rejects.toThrow(/Canceled/);
  });
});
