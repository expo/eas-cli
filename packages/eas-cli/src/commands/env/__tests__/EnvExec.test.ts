import { Config } from '@oclif/core';

import { EnvironmentVariableEnvironment } from '../../../build/utils/environment';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import EnvExec from '../exec';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../log');

describe(EnvExec, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;

  const mockEnvironmentVariables = [
    {
      id: 'var1',
      name: 'EXPO_PUBLIC_API_URL',
      value: 'https://api.example.com',
      environments: [EnvironmentVariableEnvironment.Development],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: EnvironmentVariableScope.Project,
      visibility: EnvironmentVariableVisibility.Public,
      type: EnvironmentSecretType.String,
    },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});

    // Mock GraphQL query
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValue(mockEnvironmentVariables);
  });

  it('accepts development environment when using positional argument', async () => {
    const command = new EnvExec(['development', 'echo $EXPO_PUBLIC_API_URL'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        appId: testProjectId,
        environment: EnvironmentVariableEnvironment.Development,
      }
    );
  });

  it('accepts custom environment when using positional argument', async () => {
    const command = new EnvExec(['custom-environment', 'echo $EXPO_PUBLIC_API_URL'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        appId: testProjectId,
        environment: 'custom-environment',
      }
    );
  });
});
