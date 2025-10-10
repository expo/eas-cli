import { Config } from '@oclif/core';
import * as fs from 'fs-extra';
import path from 'path';

import { DefaultEnvironment } from '../../../build/utils/environment';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import {
  EnvironmentVariableWithFileContent,
  EnvironmentVariablesQuery,
} from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import EnvPull from '../pull';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../prompts');
jest.mock('fs-extra');
jest.mock('../../../log');

describe(EnvPull, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;
  const testProjectDir = '/test/project';
  const testTargetPath = '.env.local';

  const mockEnvironmentVariables: EnvironmentVariableWithFileContent[] = [
    {
      id: 'var1',
      name: 'EXPO_PUBLIC_API_URL',
      value: 'https://api.example.com',
      environments: [DefaultEnvironment.Development],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: EnvironmentVariableScope.Project,
      visibility: EnvironmentVariableVisibility.Public,
      type: EnvironmentSecretType.String,
    },
    {
      id: 'var2',
      name: 'DATABASE_URL',
      value: 'postgres://localhost:5432/mydb',
      environments: [DefaultEnvironment.Development],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: EnvironmentVariableScope.Project,
      visibility: EnvironmentVariableVisibility.Sensitive,
      type: EnvironmentSecretType.String,
    },
    {
      id: 'var3',
      name: 'SECRET_KEY',
      value: 'super-secret-key',
      environments: [DefaultEnvironment.Development],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: EnvironmentVariableScope.Project,
      visibility: EnvironmentVariableVisibility.Secret,
      type: EnvironmentSecretType.String,
    },
    {
      id: 'var4',
      name: 'CONFIG_FILE',
      value: 'base64-encoded-file-content',
      environments: [DefaultEnvironment.Development],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: EnvironmentVariableScope.Project,
      visibility: EnvironmentVariableVisibility.Public,
      type: EnvironmentSecretType.FileBase64,
      valueWithFileContent: Buffer.from('{"key": "value"}').toString('base64'),
    },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});

    // Mock fs-extra methods
    jest.mocked(fs.exists).mockImplementation(() => Promise.resolve(false));
    jest.mocked(fs.writeFile).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.mkdir).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.readFile).mockImplementation(() => Promise.resolve(''));

    // Mock GraphQL query
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValue(mockEnvironmentVariables);
  });

  describe('environment validation', () => {
    it('accepts development environment', async () => {
      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
        graphqlClient,
        {
          appId: testProjectId,
          environment: 'development',
          includeFileContent: true,
        }
      );
    });

    it('accepts custom environment', async () => {
      const command = new EnvPull(['custom-environment'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
        graphqlClient,
        {
          appId: testProjectId,
          environment: 'custom-environment',
          includeFileContent: true,
        }
      );
    });
  });

  describe('file operations', () => {
    it('writes environment variables to .env.local file', async () => {
      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      expect(fs.writeFile).toHaveBeenCalledWith(
        testTargetPath,
        expect.stringContaining('# Environment: development')
      );
    });

    it('writes correct environment variable content', async () => {
      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      // Find the call that writes to .env.local (not the file variable)
      const writeFileCalls = jest.mocked(fs.writeFile).mock.calls;
      const envFileCall = writeFileCalls.find(call => call[0] === testTargetPath);
      expect(envFileCall).toBeDefined();
      const fileContent = envFileCall![1] as string;

      // Check that the file contains the expected content
      expect(fileContent).toContain('# Environment: development');
      expect(fileContent).toContain('EXPO_PUBLIC_API_URL=https://api.example.com');
      expect(fileContent).toContain('DATABASE_URL=postgres://localhost:5432/mydb');
      expect(fileContent).toContain('# SECRET_KEY=***** (secret)');
    });

    it('handles file variables correctly', async () => {
      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      // Should create .eas/.env directory for file variables
      expect(fs.mkdir).toHaveBeenCalledWith(path.join(testProjectDir, '.eas', '.env'), {
        recursive: true,
      });

      // Should write the file content (base64 encoded)
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(testProjectDir, '.eas', '.env', 'CONFIG_FILE'),
        Buffer.from('{"key": "value"}').toString('base64'),
        'base64'
      );

      // Should include file path in env file
      const writeFileCalls = jest.mocked(fs.writeFile).mock.calls;
      const envFileCall = writeFileCalls.find(call => call[0] === testTargetPath);
      expect(envFileCall).toBeDefined();
      const fileContent = envFileCall![1] as string;
      expect(fileContent).toContain('CONFIG_FILE=');
      expect(fileContent).toContain(path.join(testProjectDir, '.eas', '.env', 'CONFIG_FILE'));
    });

    it('prompts for overwrite when file exists in interactive mode', async () => {
      jest.mocked(fs.exists).mockImplementation(() => Promise.resolve(true));
      jest.mocked(confirmAsync).mockResolvedValue(true);

      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      expect(confirmAsync).toHaveBeenCalledWith({
        message: `File ${testTargetPath} already exists. Do you want to overwrite it?`,
      });
    });

    it('aborts when user declines overwrite', async () => {
      jest.mocked(fs.exists).mockImplementation(() => Promise.resolve(true));
      jest.mocked(confirmAsync).mockResolvedValue(false);

      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await expect(command.runAsync()).rejects.toThrow(`File ${testTargetPath} already exists.`);
    });
  });

  describe('non-interactive mode', () => {
    it('works in non-interactive mode', async () => {
      const command = new EnvPull(['development', '--non-interactive'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
        graphqlClient,
        {
          appId: testProjectId,
          environment: 'development',
          includeFileContent: true,
        }
      );
    });

    it('requires environment in non-interactive mode', async () => {
      const command = new EnvPull(['--non-interactive'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await expect(command.runAsync()).rejects.toThrow(
        'The `--environment` flag must be set when running in `--non-interactive` mode.'
      );
    });
  });

  describe('custom target path', () => {
    it('writes to custom path when specified', async () => {
      const customPath = '.env.custom';
      const command = new EnvPull(['development', '--path', customPath], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      expect(fs.writeFile).toHaveBeenCalledWith(
        customPath,
        expect.stringContaining('# Environment: development')
      );
    });
  });

  describe('logging', () => {
    it('logs success message with correct environment', async () => {
      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      expect(Log.log).toHaveBeenCalledWith(
        `Pulled plain text and sensitive environment variables from "development" environment to ${testTargetPath}.`
      );
    });

    it('logs secret variables that were skipped', async () => {
      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      expect(Log.log).toHaveBeenCalledWith(
        expect.stringContaining('The following variables have the secret visibility')
      );
      expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('SECRET_KEY'));
    });
  });

  describe('existing .env.local file handling', () => {
    it('preserves existing secret values when they exist', async () => {
      const existingEnvContent = 'SECRET_KEY=existing-secret-value\nOTHER_VAR=other-value';
      jest.mocked(fs.exists).mockImplementation(() => Promise.resolve(true));
      jest.mocked(fs.readFile).mockImplementation(() => Promise.resolve(existingEnvContent));
      jest.mocked(confirmAsync).mockResolvedValue(true);

      const command = new EnvPull(['development'], mockConfig);

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        projectId: testProjectId,
        projectDir: testProjectDir,
      });

      await command.runAsync();

      // Find the call that writes to .env.local (not the file variable)
      const writeFileCalls = jest.mocked(fs.writeFile).mock.calls;
      const envFileCall = writeFileCalls.find(call => call[0] === testTargetPath);
      expect(envFileCall).toBeDefined();
      const fileContent = envFileCall![1] as string;

      // Should use existing secret value instead of placeholder
      expect(fileContent).toContain('SECRET_KEY=existing-secret-value');
      expect(fileContent).not.toContain('# SECRET_KEY=***** (secret)');

      // Should log that it reused the local value
      expect(Log.log).toHaveBeenCalledWith(
        expect.stringContaining('Reused local values for following secrets: SECRET_KEY')
      );
    });
  });
});
