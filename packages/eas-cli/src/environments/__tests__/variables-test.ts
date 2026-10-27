import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvironmentVariableScope, EnvironmentVariableVisibility } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { EnvVar, upsertEnvVarAsync, upsertEnvVarsSequentiallyAsync } from '../variables';

jest.mock('../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../prompts');
jest.mock('../../log');

const client = {} as ExpoGraphqlClient;

const envVar: EnvVar = {
  name: 'EXPO_PUBLIC_EXAMPLE_URL',
  value: 'https://new.example.test',
  visibility: EnvironmentVariableVisibility.Public,
};

const REPLACE = { mode: 'replaceOtherEnvironments' } as const;
const KEEP = {
  mode: 'keepOtherEnvironments',
  moveConfirmMessage: (name: string, environments: string) => `Move ${name} for ${environments}?`,
} as const;

function mockRows(
  rows: {
    id: string;
    environments: string[] | null;
    value?: string;
    visibility?: EnvironmentVariableVisibility;
  }[],
  { includeAccountScoped = false }: { includeAccountScoped?: boolean } = {}
): void {
  const projectRows = rows.map(row => ({
    id: row.id,
    scope: EnvironmentVariableScope.Project,
    environments: row.environments,
    value: row.value ?? 'old',
    visibility: row.visibility ?? EnvironmentVariableVisibility.Public,
  }));
  const all = includeAccountScoped
    ? [
        ...projectRows,
        {
          id: 'account-row',
          scope: EnvironmentVariableScope.Shared,
          environments: ['production'],
          value: 'shared',
        },
      ]
    : projectRows;
  jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue(all as never);
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockResolvedValue({} as never);
  jest.mocked(EnvironmentVariableMutation.updateAsync).mockResolvedValue({} as never);
  jest.mocked(EnvironmentVariableMutation.deleteAsync).mockResolvedValue({} as never);
});

describe('upsertEnvVarAsync, no existing variable', () => {
  it.each([
    ['replaceOtherEnvironments', REPLACE],
    ['keepOtherEnvironments', KEEP],
  ])('creates without prompting in %s mode', async (_name, options) => {
    mockRows([]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, false, options)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ value: envVar.value, environments: ['production'] }),
      'app-1'
    );
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('ignores account-scoped variables of the same name', async () => {
    mockRows([], { includeAccountScoped: true });

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, false, REPLACE)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalled();
    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
  });
});

describe('upsertEnvVarAsync in replaceOtherEnvironments mode', () => {
  it('reuses the first row and deletes the rest', async () => {
    mockRows([
      { id: 'keeper', environments: ['production'] },
      { id: 'extra', environments: ['preview'] },
    ]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production', 'preview'], true, true, REPLACE)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(client, 'extra');
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        id: 'keeper',
        value: envVar.value,
        environments: ['production', 'preview'],
      })
    );
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
  });

  it('takes over environments it was not asked to write', async () => {
    mockRows([{ id: 'wide', environments: ['production', 'preview', 'development'] }]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, true, REPLACE)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ id: 'wide', environments: ['production'] })
    );
  });

  it('deletes a row whose environment list is null', async () => {
    mockRows([
      { id: 'keeper', environments: ['production'] },
      { id: 'no-envs', environments: null },
    ]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, true, REPLACE)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(client, 'no-envs');
  });

  it('prompts with the multiple-variables message when extra rows exist', async () => {
    mockRows([
      { id: 'keeper', environments: ['production'] },
      { id: 'extra', environments: ['preview'] },
    ]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], false, false, REPLACE)
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('multiple') })
    );
  });

  it('falls back to other-environments wording when extras have no environments', async () => {
    mockRows([
      { id: 'keeper', environments: null },
      { id: 'extra', environments: null },
    ]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], false, false, REPLACE)
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('other environments') })
    );
  });

  it('prompts with the single-variable message when only one row exists', async () => {
    mockRows([{ id: 'only', environments: ['production'] }]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], false, false, REPLACE)
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Overwrite it?') })
    );
  });
});

describe('upsertEnvVarAsync in keepOtherEnvironments mode', () => {
  it('shrinks an overlapping row and creates a new one', async () => {
    mockRows([{ id: 'shared', environments: ['production', 'preview'] }]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['preview'], true, true, KEEP)
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

  it('reuses a row the target environments fully cover', async () => {
    mockRows([{ id: 'preview-only', environments: ['preview'] }]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['preview', 'development'], true, true, KEEP)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ id: 'preview-only', environments: ['preview', 'development'] })
    );
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
  });

  it('leaves non-overlapping rows completely alone', async () => {
    mockRows([
      { id: 'production-only', environments: ['production'] },
      { id: 'no-envs', environments: null },
    ]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['preview'], true, false, KEEP)
    ).resolves.toBe(true);
    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalled();
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('uses the caller move message when a row loses only some environments', async () => {
    mockRows([{ id: 'shared', environments: ['production', 'preview'] }]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['preview'], false, false, KEEP)
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: `Move ${envVar.name} for preview?` })
    );
  });

  it('uses the generic message when no row loses environments', async () => {
    mockRows([{ id: 'exact', environments: ['preview'] }]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['preview'], false, false, KEEP)
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `EAS already has ${envVar.name} for preview. Overwrite it?`,
      })
    );
  });

  it('falls back to the generic message when no move message is supplied', async () => {
    mockRows([{ id: 'shared', environments: ['production', 'preview'] }]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['preview'], false, false, {
        mode: 'keepOtherEnvironments',
      })
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Overwrite it?') })
    );
  });
});

describe('upsertEnvVarAsync overwrite gate', () => {
  it.each([
    ['replaceOtherEnvironments', REPLACE],
    ['keepOtherEnvironments', KEEP],
  ])('skips and names --overwrite in non-interactive %s mode', async (_name, options) => {
    mockRows([{ id: 'existing', environments: ['production'] }]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, false, options)
    ).resolves.toBe(false);
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('pass --overwrite'));
    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['replaceOtherEnvironments', REPLACE],
    ['keepOtherEnvironments', KEEP],
  ])(
    'skips without naming --overwrite when declined interactively in %s mode',
    async (_name, options) => {
      mockRows([{ id: 'existing', environments: ['production'] }]);
      jest.mocked(confirmAsync).mockResolvedValue(false);

      await expect(
        upsertEnvVarAsync(client, 'app-1', envVar, ['production'], false, false, options)
      ).resolves.toBe(false);
      expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped updating'));
      expect(Log.warn).not.toHaveBeenCalledWith(expect.stringContaining('--overwrite'));
      expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
    }
  );

  it('still requires consent when only the visibility differs', async () => {
    mockRows([
      {
        id: 'sensitive',
        environments: ['production'],
        value: envVar.value,
        visibility: EnvironmentVariableVisibility.Sensitive,
      },
    ]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, false, REPLACE)
    ).resolves.toBe(false);
    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
  });

  it('names the environments in the prompt even when the row has none', async () => {
    mockRows([{ id: 'no-envs', environments: null }]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], false, false, REPLACE)
    ).resolves.toBe(true);
    expect(confirmAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `EAS already has ${envVar.name} for other environments. Overwrite it?`,
      })
    );
  });

  it('does not prompt when the value and environments are already correct', async () => {
    mockRows([{ id: 'exact', environments: ['production'], value: envVar.value }]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, false, KEEP)
    ).resolves.toBe(true);
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('still requires consent when the value matches but the environments differ', async () => {
    mockRows([{ id: 'exact', environments: ['production'], value: envVar.value }]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production', 'preview'], true, false, REPLACE)
    ).resolves.toBe(false);
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('pass --overwrite'));
    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
  });

  it('still requires consent when the existing row has no readable value', async () => {
    mockRows([{ id: 'secret', environments: ['production'] }]);
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'secret',
        scope: EnvironmentVariableScope.Project,
        environments: ['production'],
        value: null,
      },
    ] as never);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, false, KEEP)
    ).resolves.toBe(false);
    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
  });

  it('still requires consent when the environments match but the value differs', async () => {
    mockRows([{ id: 'exact', environments: ['production'], value: 'stale' }]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], true, false, KEEP)
    ).resolves.toBe(false);
    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
  });

  it('writes without prompting when --overwrite is passed', async () => {
    mockRows([{ id: 'existing', environments: ['production'] }]);

    await expect(
      upsertEnvVarAsync(client, 'app-1', envVar, ['production'], false, true, REPLACE)
    ).resolves.toBe(true);
    expect(confirmAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalled();
  });
});

describe('upsertEnvVarsSequentiallyAsync', () => {
  it('runs upsert for each var and collects the results in order', async () => {
    const upsert = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(
      upsertEnvVarsSequentiallyAsync(
        [
          { name: 'A', value: '1', visibility: EnvironmentVariableVisibility.Public },
          { name: 'B', value: '2', visibility: EnvironmentVariableVisibility.Public },
        ],
        upsert
      )
    ).resolves.toEqual([true, false]);
  });

  it('does not start the next upsert before the previous one settles', async () => {
    const active: string[] = [];
    const maxConcurrent = { value: 0 };
    const upsert = jest.fn(async (variable: EnvVar) => {
      active.push(variable.name);
      maxConcurrent.value = Math.max(maxConcurrent.value, active.length);
      await Promise.resolve();
      active.pop();
      return true;
    });

    await upsertEnvVarsSequentiallyAsync(
      [
        { name: 'A', value: '1', visibility: EnvironmentVariableVisibility.Public },
        { name: 'B', value: '2', visibility: EnvironmentVariableVisibility.Public },
      ],
      upsert
    );

    expect(maxConcurrent.value).toBe(1);
  });
});
