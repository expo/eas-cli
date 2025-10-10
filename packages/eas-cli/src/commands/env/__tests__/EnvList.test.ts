import { Config } from '@oclif/core';

import { getMockAppFragment } from '../../../__tests__/commands/utils';
import { DefaultEnvironment } from '../../../build/utils/environment';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentSecretType,
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../../log';
import { promptVariableEnvironmentAsync } from '../../../utils/prompts';
import EnvList from '../list';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../utils/prompts');
jest.mock('../../../log');

const mockVariables: EnvironmentVariableFragment[] = [
  {
    id: 'var1',
    name: 'TEST_VAR_1',
    value: 'value1',
    environments: [DefaultEnvironment.Production],
    scope: EnvironmentVariableScope.Project,
    visibility: EnvironmentVariableVisibility.Public,
    createdAt: undefined,
    updatedAt: undefined,
    type: EnvironmentSecretType.String,
  },
  {
    id: 'var2',
    name: 'TEST_VAR_2',
    value: 'value2',
    environments: [DefaultEnvironment.Development],
    scope: EnvironmentVariableScope.Project,
    visibility: EnvironmentVariableVisibility.Public,
    createdAt: undefined,
    updatedAt: undefined,
    type: EnvironmentSecretType.String,
  },
];

describe(EnvList, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    (jest.mocked(promptVariableEnvironmentAsync) as jest.MockedFunction<any>).mockImplementation(
      async (args: any) => {
        if (args.nonInteractive) {
          throw new Error(
            'The `--environment` flag must be set when running in `--non-interactive` mode.'
          );
        }
        if (args.multiple) {
          return [DefaultEnvironment.Production];
        }
        return DefaultEnvironment.Production;
      }
    );
  });

  it('lists project environment variables in specified environments', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValueOnce(mockVariables);

    const command = new EnvList(['--environment', 'production'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });
    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: DefaultEnvironment.Production,
      includeFileContent: false,
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });

  it('accepts development environment when using positional argument', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValueOnce(mockVariables);

    const command = new EnvList(['development'], mockConfig); // Using positional argument

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: DefaultEnvironment.Development,
      includeFileContent: false,
    });
  });

  it('lists project environment variables including sensitive values', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValueOnce(mockVariables);

    const command = new EnvList(['--include-sensitive'], mockConfig);

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
        environment: DefaultEnvironment.Production,
        includeFileContent: false,
      }
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });

  it('lists account-wide environment variables successfully', async () => {
    jest.mocked(EnvironmentVariablesQuery.sharedAsync).mockResolvedValueOnce(mockVariables);

    const command = new EnvList(['--scope', 'account'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });
    await command.runAsync();

    expect(EnvironmentVariablesQuery.sharedAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: DefaultEnvironment.Production,
      includeFileContent: false,
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });

  it('lists account-wide environment variables including sensitive values', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.sharedWithSensitiveAsync)
      .mockResolvedValueOnce(mockVariables);

    const command = new EnvList(['--include-sensitive', '--scope', 'account'], mockConfig);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });
    await command.runAsync();

    expect(EnvironmentVariablesQuery.sharedWithSensitiveAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      environment: DefaultEnvironment.Production,
      includeFileContent: false,
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_1'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('TEST_VAR_2'));
  });
});
