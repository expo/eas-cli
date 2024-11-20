import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentSecretType,
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import { promptVariableEnvironmentAsync, promptVariableNameAsync } from '../../../utils/prompts';
import EnvGet from '../get';

jest.mock('../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../utils/prompts');

describe(EnvGet, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;
  const mockVariables: EnvironmentVariableFragment[] = [
    {
      id: 'var1',
      name: 'TEST_VAR_1',
      value: 'value1',
      environments: [EnvironmentVariableEnvironment.Production],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: EnvironmentVariableScope.Project,
      visibility: EnvironmentVariableVisibility.Public,
      type: EnvironmentSecretType.String,
    },
  ];

  it('retrieves environment variables successfully', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValueOnce(mockVariables);
    jest.spyOn(Log, 'log').mockImplementation(() => {});

    const command = new EnvGet(['--variable-name', 'TEST_VAR_1'], mockConfig);

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
        environment: undefined,
        filterNames: ['TEST_VAR_1'],
        includeFileContent: true,
      }
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
  });

  it('handles errors during retrieval', async () => {
    const errorMessage =
      "Variable name is required. Run the command with '--variable-name VARIABLE_NAME' flag";

    const command = new EnvGet([], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId: testProjectId },
    });

    await expect(command.runAsync()).rejects.toThrow(errorMessage);
  });

  it('prompts for variable name and environment if the name is ambigous', async () => {
    jest
      .mocked(promptVariableEnvironmentAsync)
      .mockResolvedValueOnce(EnvironmentVariableEnvironment.Production);
    jest.mocked(promptVariableNameAsync).mockResolvedValueOnce('TEST_VAR_1');

    const command = new EnvGet([], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId: testProjectId },
    });
    jest.mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).mockResolvedValueOnce([
      ...mockVariables,
      {
        id: 'var2',
        name: 'TEST_VAR_1',
        value: 'value1',
        environments: [EnvironmentVariableEnvironment.Development],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Public,
        type: EnvironmentSecretType.String,
      },
    ]);
    await command.runAsync();

    expect(promptVariableEnvironmentAsync).toHaveBeenCalled();
    expect(promptVariableNameAsync).toHaveBeenCalled();
  });
});
