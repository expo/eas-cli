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
import EnvPush from '../push';

jest.mock('../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('fs-extra');
jest.mock('../../../log');

describe(EnvPush, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;
  const testProjectDir = '/test/project';
  const testEnvPath = '.env.test';

  const mockEnvContent = `EXPO_PUBLIC_API_URL=https://api.example.com
DATABASE_URL=postgres://localhost:5432/mydb
SECRET_KEY=super-secret-key`;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});

    // Mock fs-extra methods
    jest.mocked(fs.exists).mockImplementation(() => Promise.resolve(true));
    jest.mocked(fs.readFile).mockImplementation(() => Promise.resolve(mockEnvContent));

    // Mock GraphQL queries and mutations
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]); // No existing variables
    jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockResolvedValue({
      id: 'var1',
      name: 'EXPO_PUBLIC_API_URL',
      value: 'https://api.example.com',
      environments: [DefaultEnvironment.Development],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: EnvironmentVariableScope.Project,
      visibility: EnvironmentVariableVisibility.Public,
      type: EnvironmentSecretType.String,
    });
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
      filterNames: ['EXPO_PUBLIC_API_URL', 'DATABASE_URL', 'SECRET_KEY'],
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
      filterNames: ['EXPO_PUBLIC_API_URL', 'DATABASE_URL', 'SECRET_KEY'],
    });
  });
});
