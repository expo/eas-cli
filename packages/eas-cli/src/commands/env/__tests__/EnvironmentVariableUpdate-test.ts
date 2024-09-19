import { Config } from '@oclif/core';
import chalk from 'chalk';

import { getMockAppFragment } from '../../../__tests__/commands/utils';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableScope,
} from '../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import { promptAsync, toggleConfirmAsync } from '../../../prompts';
import EnvironmentVariableUpdate from '../update';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../prompts');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../log');

describe(EnvironmentVariableUpdate, () => {
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
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
  });

  it('updates a project variable by current name in non-interactive mode', async () => {
    const mockVariables = [
      {
        id: variableId,
        name: 'TEST_VARIABLE',
        scope: EnvironmentVariableScope.Project,
        environments: [EnvironmentVariableEnvironment.Development],
      },
    ];
    (EnvironmentVariablesQuery.byAppIdAsync as jest.Mock).mockResolvedValue(mockVariables);
    (EnvironmentVariableMutation.updateAsync as jest.Mock).mockResolvedValue(mockVariables[0]);

    const command = new EnvironmentVariableUpdate(
      [
        '--current-name',
        'TEST_VARIABLE',
        '--current-environment',
        'development',
        '--non-interactive',
        '--value',
        'new-value',
        '--name',
        'NEW_VARIABLE',
        '--environment',
        'production',
      ],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await command.runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
      id: variableId,
      name: 'NEW_VARIABLE',
      value: 'new-value',
      environments: [EnvironmentVariableEnvironment.Production],
    });
    expect(Log.withTick).toHaveBeenCalledWith(
      `Updated variable ${chalk.bold('TEST_VARIABLE')} on project @testuser/testpp.`
    );
  });

  it('updates a shared variable by current name in non-interactive mode', async () => {
    const mockVariables = [
      {
        id: variableId,
        name: 'TEST_VARIABLE',
        scope: EnvironmentVariableScope.Shared,
        environments: [EnvironmentVariableEnvironment.Development],
      },
    ];
    (EnvironmentVariablesQuery.sharedAsync as jest.Mock).mockResolvedValue(mockVariables);
    (EnvironmentVariableMutation.updateAsync as jest.Mock).mockResolvedValue(mockVariables[0]);

    const command = new EnvironmentVariableUpdate(
      [
        '--current-name',
        'TEST_VARIABLE',
        '--current-environment',
        'development',
        '--non-interactive',
        '--value',
        'new-value',
        '--name',
        'NEW_VARIABLE',
        '--environment',
        'production',
        '--scope',
        'shared',
      ],
      mockConfig
    );
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await command.runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
      id: variableId,
      name: 'NEW_VARIABLE',
      value: 'new-value',
      environments: [EnvironmentVariableEnvironment.Production],
    });
    expect(Log.withTick).toHaveBeenCalledWith(
      `Updated variable ${chalk.bold('TEST_VARIABLE')} on account testuser.`
    );
  });

  it('prompts for variable selection when current name is not provided', async () => {
    const mockVariables = [
      { id: variableId, name: 'TEST_VARIABLE', scope: EnvironmentVariableScope.Project },
    ];
    (EnvironmentVariablesQuery.byAppIdAsync as jest.Mock).mockResolvedValue(mockVariables);
    (EnvironmentVariableMutation.updateAsync as jest.Mock).mockResolvedValue(mockVariables[0]);
    (promptAsync as jest.Mock).mockResolvedValue({ variable: mockVariables[0] });
    (toggleConfirmAsync as jest.Mock).mockResolvedValue(true);

    const command = new EnvironmentVariableUpdate([], mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await command.runAsync();

    expect(promptAsync).toHaveBeenCalled();
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ id: variableId })
    );
    expect(Log.withTick).toHaveBeenCalledWith(
      `Updated variable ${chalk.bold('TEST_VARIABLE')} on project @testuser/testpp.`
    );
  });

  it('throws an error when variable name is not found', async () => {
    const mockVariables: never[] = [];
    (EnvironmentVariablesQuery.byAppIdAsync as jest.Mock).mockResolvedValue(mockVariables);

    const command = new EnvironmentVariableUpdate(
      ['--current-name', 'NON_EXISTENT_VARIABLE'],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue(mockContext);
    await expect(command.runAsync()).rejects.toThrow(
      'Variable with name NON_EXISTENT_VARIABLE  does not exist on project @testuser/testpp.'
    );
  });
});
