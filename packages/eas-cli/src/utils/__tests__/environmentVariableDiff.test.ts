import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../graphql/generated';
import { EnvironmentVariableWithFileContent } from '../../graphql/queries/EnvironmentVariablesQuery';
import {
  formatEnvironmentVariableDiffAsync,
  getEnvironmentVariableNamesFromEnvFile,
} from '../environmentVariableDiff';

jest.mock('fs-extra');

const envDir = '/project/.eas/.env';

function variable(
  name: string,
  value: string | null,
  overrides: Partial<EnvironmentVariableWithFileContent> = {}
): EnvironmentVariableWithFileContent {
  return {
    id: name,
    name,
    value,
    environments: ['development'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scope: EnvironmentVariableScope.Project,
    visibility: EnvironmentVariableVisibility.Public,
    type: EnvironmentSecretType.String,
    ...overrides,
  };
}

describe(formatEnvironmentVariableDiffAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('renders a fresh pull as a neutral baseline', async () => {
    const result = await formatEnvironmentVariableDiffAsync({
      environmentVariables: [variable('ONE', '1'), variable('TWO', '2')],
      currentEnvValues: {},
      existingVariableNames: new Set(),
      envDir,
      targetExists: false,
    });

    expect(result).toEqual(['  ONE', '  TWO']);
  });

  it('renders variables as added when the target file exists but is empty', async () => {
    const result = await formatEnvironmentVariableDiffAsync({
      environmentVariables: [variable('ONE', '1')],
      currentEnvValues: {},
      existingVariableNames: new Set(),
      envDir,
      targetExists: true,
    });

    expect(result).toEqual([chalk.green('+ ONE')]);
  });

  it('renders added, changed, unchanged, and removed string variables', async () => {
    const result = await formatEnvironmentVariableDiffAsync({
      environmentVariables: [
        variable('ADDED', 'new'),
        variable('CHANGED', 'new'),
        variable('UNCHANGED', 'same'),
      ],
      currentEnvValues: { CHANGED: 'old', UNCHANGED: 'same', REMOVED: 'old' },
      existingVariableNames: new Set(['CHANGED', 'UNCHANGED', 'REMOVED']),
      envDir,
      targetExists: true,
    });

    expect(result).toEqual([
      chalk.green('+ ADDED'),
      chalk.yellow('~ CHANGED'),
      '  UNCHANGED',
      chalk.red('- REMOVED'),
    ]);
  });

  it('keeps existing secrets neutral without claiming their values match', async () => {
    const secret = variable('SECRET', null, {
      visibility: EnvironmentVariableVisibility.Secret,
    });

    const result = await formatEnvironmentVariableDiffAsync({
      environmentVariables: [
        secret,
        variable('NEW_SECRET', null, {
          visibility: EnvironmentVariableVisibility.Secret,
        }),
      ],
      currentEnvValues: {},
      existingVariableNames: new Set(['SECRET']),
      envDir,
      targetExists: true,
    });

    expect(result).toEqual(['  SECRET', chalk.green('+ NEW_SECRET')]);
  });

  it('only considers a file unchanged when its output path and contents match', async () => {
    const fileContents = Buffer.from('contents').toString('base64');
    const fileVariable = variable('FILE', null, {
      type: EnvironmentSecretType.FileBase64,
      valueWithFileContent: fileContents,
    });
    const expectedFilePath = path.join(envDir, fileVariable.name);
    // @ts-expect-error fs-extra overloads are not inferred correctly by Jest.
    jest.mocked(fs.pathExists).mockResolvedValue(true);
    // @ts-expect-error fs-extra overloads are not inferred correctly by Jest.
    jest.mocked(fs.readFile).mockResolvedValue(fileContents);

    await expect(
      formatEnvironmentVariableDiffAsync({
        environmentVariables: [fileVariable],
        currentEnvValues: { FILE: expectedFilePath },
        existingVariableNames: new Set(['FILE']),
        envDir,
        targetExists: true,
      })
    ).resolves.toEqual(['  FILE']);

    // @ts-expect-error fs-extra overloads are not inferred correctly by Jest.
    jest.mocked(fs.readFile).mockResolvedValue(Buffer.from('different').toString('base64'));
    await expect(
      formatEnvironmentVariableDiffAsync({
        environmentVariables: [fileVariable],
        currentEnvValues: { FILE: expectedFilePath },
        existingVariableNames: new Set(['FILE']),
        envDir,
        targetExists: true,
      })
    ).resolves.toEqual([chalk.yellow('~ FILE')]);

    await expect(
      formatEnvironmentVariableDiffAsync({
        environmentVariables: [fileVariable],
        currentEnvValues: { FILE: '/some/other/file' },
        existingVariableNames: new Set(['FILE']),
        envDir,
        targetExists: true,
      })
    ).resolves.toEqual([chalk.yellow('~ FILE')]);
  });

  it('reports missing or unreadable file variables as changed instead of failing', async () => {
    const fileVariable = variable('FILE', null, {
      type: EnvironmentSecretType.FileBase64,
      valueWithFileContent: Buffer.from('contents').toString('base64'),
    });
    const expectedFilePath = path.join(envDir, fileVariable.name);
    const options = {
      environmentVariables: [fileVariable],
      currentEnvValues: { FILE: expectedFilePath },
      existingVariableNames: new Set(['FILE']),
      envDir,
      targetExists: true,
    };

    // @ts-expect-error fs-extra overloads are not inferred correctly by Jest.
    jest.mocked(fs.pathExists).mockResolvedValue(false);
    await expect(formatEnvironmentVariableDiffAsync(options)).resolves.toEqual([
      chalk.yellow('~ FILE'),
    ]);

    // @ts-expect-error fs-extra overloads are not inferred correctly by Jest.
    jest.mocked(fs.pathExists).mockResolvedValue(true);
    // @ts-expect-error fs-extra overloads are not inferred correctly by Jest.
    jest.mocked(fs.readFile).mockRejectedValue(new Error('EACCES'));
    await expect(formatEnvironmentVariableDiffAsync(options)).resolves.toEqual([
      chalk.yellow('~ FILE'),
    ]);
  });
});

describe(getEnvironmentVariableNamesFromEnvFile, () => {
  it('includes secret placeholders in the existing variable names', () => {
    const result = getEnvironmentVariableNamesFromEnvFile(
      ['PLAIN=value', '# SECRET=***** (secret)', '# unrelated comment'].join('\n')
    );

    expect(result.values).toEqual({ PLAIN: 'value' });
    expect(result.variableNames).toEqual(new Set(['PLAIN', 'SECRET']));
  });
});
