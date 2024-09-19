import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import EnvironmentVariableList from '../list';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');

describe(EnvironmentVariableList, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists environment variables successfully', async () => {
    const mockVariables = [
      {
        id: 'var1',
        name: 'TEST_VAR_1',
        value: 'value1',
        environment: EnvironmentVariableEnvironment.Production,
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Public,
      },
      {
        id: 'var2',
        name: 'TEST_VAR_2',
        value: 'value2',
        environment: EnvironmentVariableEnvironment.Development,
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Public,
      },
    ];

    EnvironmentVariablesQuery.byAppIdAsync.mockResolvedValueOnce(mockVariables);

    const command = new EnvironmentVariableList([], mockConfig);
    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      projectId: testProjectId,
    });
    expect(command.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(command.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });

  it('handles errors during listing', async () => {
    const errorMessage = 'Failed to list environment variables';
    EnvironmentVariablesQuery.byAppIdAsync.mockRejectedValueOnce(new Error(errorMessage));

    const command = new EnvironmentVariableList([], mockConfig);
    await expect(command.runAsync()).rejects.toThrow(errorMessage);

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      projectId: testProjectId,
    });
  });
});
