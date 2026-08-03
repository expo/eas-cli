import * as fs from 'fs-extra';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import {
  EAS_SUPABASE_PUBLISHABLE_KEY_ENV_VAR_NAME,
  EAS_SUPABASE_URL_ENV_VAR_NAME,
  createSupabaseEnvVars,
  ensureAdditionalEnvWritesAllowedAsync,
  mergeEnvContent,
  upsertEasEnvVarAsync,
  upsertEasEnvVarForEnvironmentsAsync,
  writeEnvLocalAsync,
  writeEnvVarsAsync,
} from '../env';

jest.mock('fs-extra');
jest.mock('../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../prompts');
jest.mock('../../../log');

describe('createSupabaseEnvVars / mergeEnvContent / writeEnvVarsAsync', () => {
  it('createSupabaseEnvVars returns public URL and key vars', () => {
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

  it('mergeEnvContent updates existing keys and appends new ones', () => {
    expect(mergeEnvContent('FOO=1\n', { FOO: '2', BAR: '3' })).toBe('FOO=2\nBAR=3\n');
    expect(mergeEnvContent('FOO=1', { BAR: '3' })).toBe('FOO=1\nBAR=3\n');
  });

  it('writeEnvVarsAsync runs upsert for each var', async () => {
    const upsert = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(
      writeEnvVarsAsync(
        [
          {
            name: 'A',
            value: '1',
            visibility: EnvironmentVariableVisibility.Public,
          },
          {
            name: 'B',
            value: '2',
            visibility: EnvironmentVariableVisibility.Public,
          },
        ],
        upsert
      )
    ).resolves.toEqual([true, false]);
  });
});

describe('writeEnvLocalAsync', () => {
  const envVars = createSupabaseEnvVars('https://example.supabase.co', 'pk');

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(fs.pathExists).mockResolvedValue(false as never);
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
  });

  it('writes a new .env.local file', async () => {
    await expect(writeEnvLocalAsync('/project', envVars, true, false)).resolves.toBe(true);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.env.local'),
      expect.stringContaining(EAS_SUPABASE_URL_ENV_VAR_NAME)
    );
    expect(Log.withTick).toHaveBeenCalled();
  });

  it('skips conflicts in non-interactive mode without overwrite', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue(`${EAS_SUPABASE_URL_ENV_VAR_NAME}=old\n` as never);

    await expect(writeEnvLocalAsync('/project', envVars, true, false)).resolves.toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('skipped'));
  });

  it('prompts on conflicts interactively and skips when declined', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue(`${EAS_SUPABASE_URL_ENV_VAR_NAME}=old\n` as never);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(writeEnvLocalAsync('/project', envVars, false, false)).resolves.toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('overwrites conflicts when confirmed or --overwrite', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue(`${EAS_SUPABASE_URL_ENV_VAR_NAME}=old\n` as never);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(writeEnvLocalAsync('/project', envVars, false, false)).resolves.toBe(true);
    await expect(writeEnvLocalAsync('/project', envVars, true, true)).resolves.toBe(true);
    expect(fs.writeFile).toHaveBeenCalled();
  });
});

describe('upsertEasEnvVarAsync', () => {
  const client = {} as ExpoGraphqlClient;
  const envVar = createSupabaseEnvVars('https://example.supabase.co', 'pk')[0];

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('creates when no project-scoped variable exists', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]);
    jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockResolvedValue({} as never);

    await expect(
      upsertEasEnvVarAsync(client, 'app-1', envVar, ['production'], true, false)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalled();
  });

  it('skips existing variable without overwrite in non-interactive mode', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'v1',
        scope: EnvironmentVariableScope.Project,
        environments: ['production'],
      } as never,
    ]);

    await expect(
      upsertEasEnvVarAsync(client, 'app-1', envVar, ['production'], true, false)
    ).resolves.toBe(false);
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('--overwrite'));
  });

  it('updates existing variable and deletes extras when overwriting', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'keeper',
        scope: EnvironmentVariableScope.Project,
        environments: ['production'],
      },
      {
        id: 'extra',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
      },
    ] as never);
    jest.mocked(EnvironmentVariableMutation.deleteAsync).mockResolvedValue({} as never);
    jest.mocked(EnvironmentVariableMutation.updateAsync).mockResolvedValue({} as never);

    await expect(
      upsertEasEnvVarAsync(client, 'app-1', envVar, ['production', 'preview'], true, true)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(client, 'extra');
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ id: 'keeper' })
    );
  });

  it('prompts with multi-variable message interactively', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'keeper',
        scope: EnvironmentVariableScope.Project,
        environments: ['production'],
      },
      {
        id: 'extra',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
      },
    ] as never);
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(EnvironmentVariableMutation.deleteAsync).mockResolvedValue({} as never);
    jest.mocked(EnvironmentVariableMutation.updateAsync).mockResolvedValue({} as never);

    await expect(
      upsertEasEnvVarAsync(client, 'app-1', envVar, ['production'], false, false)
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('multiple') })
    );
  });

  it('uses other-environments wording when extras have no environment lists', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'keeper',
        scope: EnvironmentVariableScope.Project,
        environments: ['production'],
      },
      {
        id: 'extra',
        scope: EnvironmentVariableScope.Project,
        environments: null,
      },
    ] as never);
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(EnvironmentVariableMutation.deleteAsync).mockResolvedValue({} as never);
    jest.mocked(EnvironmentVariableMutation.updateAsync).mockResolvedValue({} as never);

    await expect(
      upsertEasEnvVarAsync(client, 'app-1', envVar, ['production'], false, false)
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('other environments') })
    );
  });

  it('skips interactively without mentioning --overwrite', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'v1',
        scope: EnvironmentVariableScope.Project,
        environments: ['production'],
      } as never,
    ]);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      upsertEasEnvVarAsync(client, 'app-1', envVar, ['production'], false, false)
    ).resolves.toBe(false);
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped updating'));
    expect(Log.warn).not.toHaveBeenCalledWith(expect.stringContaining('--overwrite'));
  });
});

describe('ensureAdditionalEnvWritesAllowedAsync', () => {
  const client = {} as ExpoGraphqlClient;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns true immediately with overwrite', async () => {
    await expect(
      ensureAdditionalEnvWritesAllowedAsync(client, 'app-1', ['preview'], true, true)
    ).resolves.toBe(true);
    expect(EnvironmentVariablesQuery.byAppIdAsync).not.toHaveBeenCalled();
  });

  it('returns false when there is no overlap', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]);
    await expect(
      ensureAdditionalEnvWritesAllowedAsync(client, 'app-1', ['preview'], true, false)
    ).resolves.toBe(false);
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
      ensureAdditionalEnvWritesAllowedAsync(client, 'app-1', ['preview'], true, false)
    ).resolves.toBe(false);
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
      ensureAdditionalEnvWritesAllowedAsync(client, 'app-1', ['preview'], true, false)
    ).rejects.toThrow(/Re-run with --overwrite/);
  });

  it('returns true after interactive confirmation', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'v1',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
      } as never,
    ]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      ensureAdditionalEnvWritesAllowedAsync(client, 'app-1', ['preview'], false, false)
    ).resolves.toBe(true);
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
      ensureAdditionalEnvWritesAllowedAsync(client, 'app-1', ['preview'], false, false)
    ).rejects.toThrow(/Canceled/);
  });
});

describe('upsertEasEnvVarForEnvironmentsAsync', () => {
  const client = {} as ExpoGraphqlClient;
  const envVar = createSupabaseEnvVars('https://example.supabase.co', 'pk')[0];

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockResolvedValue({} as never);
    jest.mocked(EnvironmentVariableMutation.updateAsync).mockResolvedValue({} as never);
    jest.mocked(EnvironmentVariableMutation.deleteAsync).mockResolvedValue({} as never);
  });

  it('updates an exact environment match', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'exact',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
        value: 'old',
      } as never,
    ]);

    await expect(
      upsertEasEnvVarForEnvironmentsAsync(client, 'app-1', envVar, ['preview'], true, true)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ id: 'exact' })
    );
  });

  it('skips exact match without overwrite when values differ', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'exact',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
        value: 'old',
      } as never,
    ]);

    await expect(
      upsertEasEnvVarForEnvironmentsAsync(client, 'app-1', envVar, ['preview'], true, false)
    ).resolves.toBe(false);
  });

  it('auto-overwrites exact match when values already match', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'exact',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
        value: envVar.value,
      } as never,
    ]);

    await expect(
      upsertEasEnvVarForEnvironmentsAsync(client, 'app-1', envVar, ['preview'], true, false)
    ).resolves.toBe(true);
  });

  it('creates after shrinking overlapping environments', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'shared',
        scope: EnvironmentVariableScope.Project,
        environments: ['production', 'preview'],
        value: 'old',
      } as never,
    ]);

    await expect(
      upsertEasEnvVarForEnvironmentsAsync(client, 'app-1', envVar, ['preview'], true, true)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(client, {
      id: 'shared',
      environments: ['production'],
    });
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ value: envVar.value, environments: ['preview'] }),
      'app-1'
    );
  });

  it('skips when overlapping move is declined', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'shared',
        scope: EnvironmentVariableScope.Project,
        environments: ['production', 'preview'],
        value: 'old',
      } as never,
    ]);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      upsertEasEnvVarForEnvironmentsAsync(client, 'app-1', envVar, ['preview'], false, false)
    ).resolves.toBe(false);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('to the additional Supabase project?'),
      })
    );
  });

  it('deletes variables fully covered by the target environments', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'preview-only',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
        value: 'old',
      },
    ] as never);

    await expect(
      upsertEasEnvVarForEnvironmentsAsync(
        client,
        'app-1',
        envVar,
        ['preview', 'development'],
        true,
        true
      )
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(client, 'preview-only');
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalled();
  });

  it('ignores variables with no overlapping environments', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'production-only',
        scope: EnvironmentVariableScope.Project,
        environments: ['production'],
        value: 'old',
      },
      {
        id: 'no-envs',
        scope: EnvironmentVariableScope.Project,
        environments: null,
        value: 'old',
      },
    ] as never);

    await expect(
      upsertEasEnvVarForEnvironmentsAsync(client, 'app-1', envVar, ['preview'], true, false)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalled();
  });

  it('prompts before overwriting an exact match interactively', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'exact',
        scope: EnvironmentVariableScope.Project,
        environments: ['preview'],
        value: 'old',
      } as never,
    ]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      upsertEasEnvVarForEnvironmentsAsync(client, 'app-1', envVar, ['preview'], false, false)
    ).resolves.toBe(true);
  });
});
