import { Config } from '@oclif/core';

import { getMockAppFragment } from '../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import EnvironmentVariableList from '../list';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../log');

const mockVariables: EnvironmentVariableFragment[] = [
  {
    id: 'var1',
    name: 'TEST_VAR_1',
    value: 'value1',
    environments: [EnvironmentVariableEnvironment.Production],
    scope: EnvironmentVariableScope.Project,
    visibility: EnvironmentVariableVisibility.Public,
    createdAt: undefined,
    updatedAt: undefined,
  },
  {
    id: 'var2',
    name: 'TEST_VAR_2',
    value: 'value2',
    environments: [EnvironmentVariableEnvironment.Development],
    scope: EnvironmentVariableScope.Project,
    visibility: EnvironmentVariableVisibility.Public,
    createdAt: undefined,
    updatedAt: undefined,
  },
];

describe(EnvironmentVariableList, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
  });

  it('lists project environment variables successfully', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValueOnce(mockVariables);

    const command = new EnvironmentVariableList([], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId: testProjectId },
    });
    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: undefined,
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });

  it('lists project environment variables in specified environments', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValueOnce(mockVariables);

    const command = new EnvironmentVariableList(['--environment', 'production'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId: testProjectId },
    });
    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: EnvironmentVariableEnvironment.Production,
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });

  it('lists project environment variables including sensitive values', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValueOnce(mockVariables);

    const command = new EnvironmentVariableList(['--include-sensitive'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId: testProjectId },
    });
    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        appId: testProjectId,
        environment: undefined,
      }
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });

  it('lists shared environment variables successfully', async () => {
    jest.mocked(EnvironmentVariablesQuery.sharedAsync).mockResolvedValueOnce(mockVariables);

    const command = new EnvironmentVariableList(['--scope', 'shared'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId: testProjectId },
    });
    await command.runAsync();

    expect(EnvironmentVariablesQuery.sharedAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: undefined,
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });

  it('lists shared environment variables including sensitive values', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.sharedWithSensitiveAsync)
      .mockResolvedValueOnce(mockVariables);

    const command = new EnvironmentVariableList(
      ['--include-sensitive', '--scope', 'shared'],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      privateProjectConfig: { projectId: testProjectId },
    });
    await command.runAsync();

    expect(EnvironmentVariablesQuery.sharedWithSensitiveAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: undefined,
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });
});
