import { Config } from '@oclif/core';

import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableScope,
} from '../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import { promptAsync, toggleConfirmAsync } from '../../../prompts';
import EnvDelete from '../delete';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../prompts');
jest.mock('../../../log');

describe(EnvDelete, () => {
  const projectId = 'test-project-id';
  const variableId = '1';
  const graphqlClient = {};
  const mockConfig = {} as unknown as Config;
  const mockContext = {
    privateProjectConfig: { projectId },
    loggedIn: { graphqlClient },
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('deletes a variable by name in non-interactive mode', async () => {
    const mockVariables = [
      {
        id: variableId,
        name: 'TEST_VARIABLE',
        scope: EnvironmentVariableScope.Project,
        environments: [EnvironmentVariableEnvironment.Production],
      },
    ];
    (EnvironmentVariablesQuery.byAppIdAsync as jest.Mock).mockResolvedValue(mockVariables);

    const command = new EnvDelete(
      [
        '--variable-name',
        'TEST_VARIABLE',
        '--variable-environment',
        'production',
        '--non-interactive',
      ],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await command.runAsync();

    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(graphqlClient, variableId);
    expect(Log.withTick).toHaveBeenCalledWith('️Deleted variable TEST_VARIABLE".');
  });

  it('prompts for variable selection when name is not provided', async () => {
    const mockVariables = [
      { id: variableId, name: 'TEST_VARIABLE', scope: EnvironmentVariableScope.Project },
    ];
    (EnvironmentVariablesQuery.byAppIdAsync as jest.Mock).mockResolvedValue(mockVariables);
    (promptAsync as jest.Mock).mockResolvedValue({ variable: mockVariables[0] });
    (toggleConfirmAsync as jest.Mock).mockResolvedValue(true);

    const command = new EnvDelete([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await command.runAsync();

    expect(promptAsync).toHaveBeenCalled();
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(graphqlClient, variableId);
    expect(Log.withTick).toHaveBeenCalledWith('️Deleted variable TEST_VARIABLE".');
  });

  it('throws an error when variable name is not found', async () => {
    const mockVariables = [
      { id: variableId, name: 'TEST_VARIABLE', scope: EnvironmentVariableScope.Project },
    ];
    (EnvironmentVariablesQuery.byAppIdAsync as jest.Mock).mockResolvedValue(mockVariables);

    const command = new EnvDelete(['--variable-name', 'NON_EXISTENT_VARIABLE'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await expect(command.runAsync()).rejects.toThrow('Variable "NON_EXISTENT_VARIABLE" not found.');
  });

  it('throws an error when multiple variables with the same name are found', async () => {
    const mockVariables = [
      { id: variableId, name: 'TEST_VARIABLE', scope: EnvironmentVariableScope.Project },
      { id: '2', name: 'TEST_VARIABLE', scope: EnvironmentVariableScope.Project },
    ];
    (EnvironmentVariablesQuery.byAppIdAsync as jest.Mock).mockResolvedValue(mockVariables);

    const command = new EnvDelete(['--variable-name', 'TEST_VARIABLE'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await expect(command.runAsync()).rejects.toThrow(
      'Multiple variables with name "TEST_VARIABLE" found. Please select the variable to delete interactively or run command with --variable-environment ENVIRONMENT option.'
    );
  });

  it('cancels deletion when user does not confirm', async () => {
    const mockVariables = [
      { id: variableId, name: 'TEST_VARIABLE', scope: EnvironmentVariableScope.Project },
    ];
    (EnvironmentVariablesQuery.byAppIdAsync as jest.Mock).mockResolvedValue(mockVariables);
    (promptAsync as jest.Mock).mockResolvedValue({ variable: mockVariables[0] });
    (toggleConfirmAsync as jest.Mock).mockResolvedValue(false);

    const command = new EnvDelete(['--non-interactive'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await expect(command.runAsync()).rejects.toThrowErrorMatchingSnapshot();

    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
  });
});
