import { Config } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { EnvironmentSecretType, EnvironmentVariableVisibility } from '../../../graphql/generated';
import {
  EnvironmentVariableWithFileContent,
  EnvironmentVariablesQuery,
} from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import EnvPull from '../pull';

jest.mock('fs');
jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
// jest.mock('../../../log');
jest.mock('../../../prompts');
jest.mock('../../../utils/prompts');

beforeEach(async () => {
  vol.reset();
});

describe(EnvPull, () => {
  const mockConfig = {} as unknown as Config;
  const graphqlClient = {};
  const projectId = 'test-project-id';
  const mockContext = {
    projectId,
    loggedIn: { graphqlClient },
    projectDir: '/mock/project/dir',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    vol.reset();
  });

  it('pulls environment variables and writes to .env file', async () => {
    const mockVariables = [
      {
        name: 'TEST_VAR',
        value: 'value',
        type: EnvironmentSecretType.String,
        visibility: EnvironmentVariableVisibility.Public,
      },
      {
        name: 'FILE_VAR',
        valueWithFileContent: 'value',
        type: EnvironmentSecretType.FileBase64,
        visibility: EnvironmentVariableVisibility.Public,
      },
      {
        name: 'SECRET_VAR',
        value: null,
        type: EnvironmentSecretType.String,
        visibility: EnvironmentVariableVisibility.Secret,
      },
      {
        name: 'SENSITIVE_VAR',
        value: 'value',
        type: EnvironmentSecretType.String,
        visibility: EnvironmentVariableVisibility.Sensitive,
      },
    ];
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValue(mockVariables as EnvironmentVariableWithFileContent[]);

    // @ts-expect-error
    jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    // @ts-expect-error
    jest.spyOn(Log, 'log').mockResolvedValue(undefined);

    const command = new EnvPull(['--environment', 'production'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);

    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        appId: projectId,
        environment: 'PRODUCTION',
        includeFileContent: true,
      }
    );

    const expectedFileContent = [
      '# Environment: production',
      '',
      'TEST_VAR=value',
      'FILE_VAR=/mock/project/dir/.eas/.env/FILE_VAR',
      '# SECRET_VAR=***** (secret)',
      'SENSITIVE_VAR=value',
    ];

    expect(fs.writeFile).toHaveBeenNthCalledWith(
      1,
      '/mock/project/dir/.eas/.env/FILE_VAR',
      'value',
      'base64'
    );

    expect(fs.writeFile).toHaveBeenNthCalledWith(2, '.env.local', expectedFileContent.join('\n'));

    expect(Log.log).toHaveBeenCalledWith(
      `Pulled plain text and sensitive environment variables from "production" environment to .env.local.`
    );
  });

  it('throws an error if the environment is invalid', async () => {
    const command = new EnvPull(['--environment', 'invalid'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);

    await expect(command.runAsync()).rejects.toThrow(
      /Expected --environment=invalid to be one of: development, preview, production/
    );
  });

  it('overwrites existing .env file if confirmed', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValue([] as EnvironmentVariableWithFileContent[]);

    vol.fromJSON({
      './.env.local': '',
    });

    // @ts-expect-error
    jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    const command = new EnvPull(['--environment', 'production'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);

    await command.runAsync();

    expect(confirmAsync).toHaveBeenCalledWith({
      message: 'File .env.local already exists. Do you want to overwrite it?',
    });
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('aborts if user declines to overwrite existing .env file', async () => {
    vol.fromJSON({
      './.env.local': 'existing content',
    });
    jest.mocked(confirmAsync).mockResolvedValue(false);
    // @ts-expect-error
    jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const command = new EnvPull(['--environment', 'production'], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);

    await expect(command.runAsync()).rejects.toThrow('File .env.local already exists.');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('handles secret variables correctly', async () => {
    const mockVariables = [
      {
        name: 'SECRET_VAR',
        value: '*****',
        type: EnvironmentSecretType.String,
        visibility: EnvironmentVariableVisibility.Secret,
      },
    ];
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValue(mockVariables as EnvironmentVariableWithFileContent[]);

    const command = new EnvPull(['--environment', 'production', '--non-interactive'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    // @ts-expect-error
    jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(Log, 'log').mockImplementation(() => {});

    await command.runAsync();

    expect(fs.writeFile).toHaveBeenCalledWith(
      '.env.local',
      expect.stringContaining('# SECRET_VAR=***** (secret)')
    );
    expect(Log.log).toHaveBeenCalledWith(
      "The following variables have the secret visibility and can't be read outside of EAS servers. Set their values manually in your .env file: SECRET_VAR."
    );
  });

  it('diffLogAsync generates correct diff log', async () => {
    const mockVariables = [
      { name: 'NEW_VAR', value: 'new_value', type: EnvironmentSecretType.String },
      { name: 'UNCHANGED_VAR', value: 'unchanged_value', type: EnvironmentSecretType.String },
      {
        name: 'UNCHANGED_FILE_VAR',
        valueWithFileContent: Buffer.from('unchanged_value').toString('base64'),
        type: EnvironmentSecretType.FileBase64,
      },
      { name: 'CHANGED_VAR', value: 'changed_value', type: EnvironmentSecretType.String },
      {
        name: 'CHANGED_FILE_VAR',
        valueWithFileContent: Buffer.from('changed_value').toString('base64'),
        type: EnvironmentSecretType.FileBase64,
      },
    ];

    vol.fromJSON({
      './.eas/.env/UNCHANGED_FILE_VAR': 'unchanged_value',
      './.eas/.env/CHANGED_FILE_VAR': 'changing_value',
    });

    const currentEnvLocal = {
      UNCHANGED_VAR: 'unchanged_value',
      CHANGED_VAR: 'changing_value',
      UNCHANGED_FILE_VAR: './.eas/.env/UNCHANGED_FILE_VAR',
      CHANGED_FILE_VAR: './.eas/.env/CHANGED_FILE_VAR',
      REMOVED_VAR: 'removed_value',
    };

    const command = new EnvPull([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);

    // @ts-expect-error
    const diffLog = await command.diffLogAsync(mockVariables, currentEnvLocal);

    expect(diffLog).toEqual([
      chalk.green('+ NEW_VAR'),
      '  UNCHANGED_VAR',
      '  UNCHANGED_FILE_VAR',
      chalk.yellow('~ CHANGED_VAR'),
      chalk.yellow('~ CHANGED_FILE_VAR'),
      chalk.red('- REMOVED_VAR'),
    ]);
  });
});
