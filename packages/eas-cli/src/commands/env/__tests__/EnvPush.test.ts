import { Config } from '@oclif/core';
import * as fs from 'fs-extra';

import { DefaultEnvironment } from '../../../build/utils/environment';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import EnvPush from '../push';

jest.mock('../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('fs-extra');
jest.mock('../../../log');
jest.mock('../../../prompts');

describe(EnvPush, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;
  const testProjectDir = '/test/project';
  const testEnvPath = '.env.test';

  const mockEnvContent = `EXPO_PUBLIC_API_URL=https://api.example.com
VARIABLE_NAME=variable value
SECRET_KEY=super-secret-key`;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'error').mockImplementation(() => {});

    // Mock fs-extra methods
    jest.mocked(fs.exists).mockImplementation(() => Promise.resolve(true));
    jest.mocked(fs.readFile).mockImplementation(() => Promise.resolve(mockEnvContent));

    // Mock GraphQL queries and mutations
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]); // No existing variables
    jest
      .mocked(EnvironmentVariableMutation.createBulkEnvironmentVariablesForAppAsync)
      .mockResolvedValue(true);
    jest.mocked(confirmAsync).mockResolvedValue(true);
  });

  it('accepts development environment when using positional argument', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValueOnce([]);

    const command = new EnvPush(['development', '--path', testEnvPath], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
      projectDir: testProjectDir,
    });

    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: DefaultEnvironment.Development,
      filterNames: ['EXPO_PUBLIC_API_URL', 'VARIABLE_NAME', 'SECRET_KEY'],
    });
  });

  it('accepts custom environment', async () => {
    const command = new EnvPush(['custom-environment', '--path', testEnvPath], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
      projectDir: testProjectDir,
    });

    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: 'custom-environment',
      filterNames: ['EXPO_PUBLIC_API_URL', 'VARIABLE_NAME', 'SECRET_KEY'],
    });
  });

  describe('--force option', () => {
    it('automatically overrides existing variables without confirmation when --force is used', async () => {
      const existingVariable = {
        id: 'var1',
        name: 'VARIABLE_NAME',
        value: 'old variable value',
        environments: [DefaultEnvironment.Development],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Sensitive,
        type: EnvironmentSecretType.String,
      };

      jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([existingVariable]);

      const command = new EnvPush(['development', '--path', testEnvPath, '--force'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      // Should not call confirmAsync for existing variables
      expect(confirmAsync).not.toHaveBeenCalled();

      // Should log that force flag is being used
      expect(Log.log).toHaveBeenCalledWith(
        'Using --force flag: automatically overriding existing variables.'
      );

      // Should call the mutation with overwrite flag
      expect(
        EnvironmentVariableMutation.createBulkEnvironmentVariablesForAppAsync
      ).toHaveBeenCalledWith(
        graphqlClient,
        expect.arrayContaining([
          expect.objectContaining({
            name: 'VARIABLE_NAME',
            value: 'variable value',
            environments: [DefaultEnvironment.Development],
            overwrite: true,
          }),
        ]),
        testProjectId
      );
    });

    it('automatically overrides sensitive variables without confirmation when --force is used', async () => {
      const existingSensitiveVariable = {
        id: 'var1',
        name: 'SECRET_KEY',
        value: 'old-secret-key',
        environments: [DefaultEnvironment.Development],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Sensitive,
        type: EnvironmentSecretType.String,
      };

      jest
        .mocked(EnvironmentVariablesQuery.byAppIdAsync)
        .mockResolvedValue([existingSensitiveVariable]);

      const command = new EnvPush(['development', '--path', testEnvPath, '--force'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      // Should not call confirmAsync for sensitive variables
      expect(confirmAsync).not.toHaveBeenCalled();

      // Should log that force flag is being used for sensitive variables
      expect(Log.log).toHaveBeenCalledWith(
        'Using --force flag: automatically overriding sensitive variables.'
      );

      // Should call the mutation with overwrite flag
      expect(
        EnvironmentVariableMutation.createBulkEnvironmentVariablesForAppAsync
      ).toHaveBeenCalledWith(
        graphqlClient,
        expect.arrayContaining([
          expect.objectContaining({
            name: 'SECRET_KEY',
            value: 'super-secret-key',
            environments: [DefaultEnvironment.Development],
            overwrite: true,
          }),
        ]),
        testProjectId
      );
    });

    it('logs appropriate messages when using --force flag', async () => {
      const existingVariable = {
        id: 'var1',
        name: 'VARIABLE_NAME',
        value: 'old variable value',
        environments: [DefaultEnvironment.Development],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Sensitive,
        type: EnvironmentSecretType.String,
      };

      jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([existingVariable]);

      const command = new EnvPush(['development', '--path', testEnvPath, '--force'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      // Should log both force messages
      expect(Log.log).toHaveBeenCalledWith(
        'Using --force flag: automatically overriding existing variables.'
      );
      expect(Log.log).toHaveBeenCalledWith(
        'Using --force flag: automatically overriding sensitive variables.'
      );
    });

    it('still prompts for confirmation when --force is not used', async () => {
      const existingVariable = {
        id: 'var1',
        name: 'VARIABLE_NAME',
        value: 'old variable value',
        environments: [DefaultEnvironment.Development],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Sensitive,
        type: EnvironmentSecretType.String,
      };

      jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([existingVariable]);
      jest.mocked(confirmAsync).mockResolvedValue(true);

      const command = new EnvPush(['development', '--path', testEnvPath], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      // Should call confirmAsync for both existing variables and sensitive variables
      expect(confirmAsync).toHaveBeenCalledTimes(2);
      expect(confirmAsync).toHaveBeenCalledWith({
        message:
          'The VARIABLE_NAME environment variable already exists in development environment. Do you want to override it?',
      });
      expect(confirmAsync).toHaveBeenCalledWith({
        message:
          'You are about to overwrite sensitive variables.\n- VARIABLE_NAME\n Do you want to continue?',
      });

      // Should not log force messages
      expect(Log.log).not.toHaveBeenCalledWith(
        'Using --force flag: automatically overriding existing variables.'
      );
      expect(Log.log).not.toHaveBeenCalledWith(
        'Using --force flag: automatically overriding sensitive variables.'
      );
    });
  });
});
