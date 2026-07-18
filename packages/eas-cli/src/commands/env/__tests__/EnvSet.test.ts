import fs from 'fs-extra';

import { getMockAppFragment, getMockOclifConfig } from '../../../__tests__/commands/utils';
import { DefaultEnvironment } from '../../../build/utils/environment';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import {
  parseVisibility,
  promptVariableEnvironmentAsync,
  promptVariableNameAsync,
  promptVariableTypeAsync,
  promptVariableValueAsync,
} from '../../../utils/prompts';
import EnvSet from '../set';

jest.mock('../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../utils/prompts');
jest.mock('../../../utils/json');
jest.mock('fs-extra');

describe(EnvSet, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const variableId = 'testId';
  const testAccountId = 'test-account-id';

  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(parseVisibility)
      .mockImplementation(jest.requireActual('../../../utils/prompts').parseVisibility);

    jest.mocked(AppQuery.byIdAsync).mockImplementation(async () => getMockAppFragment());
    jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mockImplementation(async (_client, input, _appId) => ({
        ...input,
        id: variableId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Project,
        type: EnvironmentSecretType.String,
      }));
    jest
      .mocked(EnvironmentVariableMutation.createSharedVariableAsync)
      .mockImplementation(async (_client, input, _appId) => ({
        ...input,
        id: variableId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Shared,
        type: EnvironmentSecretType.String,
      }));
    jest
      .mocked(EnvironmentVariableMutation.updateAsync)
      .mockImplementation(async (_client, input) => ({
        ...input,
        id: variableId,
        name: 'VarName',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Project,
        type: EnvironmentSecretType.String,
      }));
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockImplementation(async () => []);
    jest.mocked(EnvironmentVariablesQuery.sharedAsync).mockImplementation(async () => []);
  });

  it('creates a project variable when none exists', async () => {
    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        'VarValue',
        '--environment',
        'production',
        '--visibility',
        'secret',
      ],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        name: 'VarName',
        value: 'VarValue',
        environments: [DefaultEnvironment.Production],
        visibility: EnvironmentVariableVisibility.Secret,
        type: EnvironmentSecretType.String,
      },
      testProjectId
    );
    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
  });

  it('updates an existing project variable in the same environment without --force', async () => {
    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        'VarValue',
        '--environment',
        'production',
        '--visibility',
        'secret',
      ],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    const otherVariableId = 'otherId';

    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      // @ts-expect-error
      .mockImplementation(async () => [
        {
          id: otherVariableId,
          environments: [DefaultEnvironment.Production],
          scope: EnvironmentVariableScope.Project,
        },
      ]);

    await command.runAsync();

    expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      filterNames: ['VarName'],
    });

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
      id: otherVariableId,
      name: 'VarName',
      value: 'VarValue',
      environments: [DefaultEnvironment.Production],
      visibility: EnvironmentVariableVisibility.Secret,
      type: undefined,
      fileName: undefined,
    });
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
  });

  it('preserves other environments when updating an existing project variable', async () => {
    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        'VarValue',
        '--environment',
        'production',
        '--visibility',
        'secret',
      ],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    const otherVariableId = 'otherId';
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      // @ts-expect-error
      .mockImplementation(async () => [
        {
          id: otherVariableId,
          environments: [DefaultEnvironment.Production, DefaultEnvironment.Preview],
          scope: EnvironmentVariableScope.Project,
        },
      ]);

    await command.runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
      id: otherVariableId,
      name: 'VarName',
      value: 'VarValue',
      environments: [DefaultEnvironment.Production, DefaultEnvironment.Preview],
      visibility: EnvironmentVariableVisibility.Secret,
      type: undefined,
      fileName: undefined,
    });
  });

  it('creates an account-wide variable when none exists', async () => {
    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        'VarValue',
        '--environment',
        'production',
        '--scope',
        'account',
      ],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(EnvironmentVariableMutation.createSharedVariableAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        name: 'VarName',
        value: 'VarValue',
        environments: [DefaultEnvironment.Production],
        visibility: EnvironmentVariableVisibility.Public,
        type: EnvironmentSecretType.String,
      },
      testAccountId
    );
  });

  it('updates an existing account-wide variable without --force', async () => {
    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        'VarValue',
        '--environment',
        'production',
        '--scope',
        'account',
      ],
      mockConfig
    );

    const otherVariableId = 'otherId';

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    jest
      .mocked(EnvironmentVariablesQuery.sharedAsync)
      // @ts-expect-error
      .mockImplementation(async () => [
        {
          id: otherVariableId,
          environments: [DefaultEnvironment.Production],
          scope: EnvironmentVariableScope.Shared,
        },
      ]);

    await command.runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
      id: otherVariableId,
      name: 'VarName',
      value: 'VarValue',
      environments: [DefaultEnvironment.Production],
      visibility: EnvironmentVariableVisibility.Public,
      type: undefined,
    });
    expect(EnvironmentVariableMutation.createSharedVariableAsync).not.toHaveBeenCalled();
  });

  it('preserves other environments when updating an existing account-wide variable', async () => {
    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        'VarValue',
        '--environment',
        'production',
        '--scope',
        'account',
      ],
      mockConfig
    );

    const otherVariableId = 'otherId';

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    jest
      .mocked(EnvironmentVariablesQuery.sharedAsync)
      // @ts-expect-error
      .mockImplementation(async () => [
        {
          id: otherVariableId,
          environments: [DefaultEnvironment.Production, DefaultEnvironment.Preview],
          scope: EnvironmentVariableScope.Shared,
        },
      ]);

    await command.runAsync();

    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
      id: otherVariableId,
      name: 'VarName',
      value: 'VarValue',
      environments: [DefaultEnvironment.Production, DefaultEnvironment.Preview],
      visibility: EnvironmentVariableVisibility.Public,
      type: undefined,
    });
  });

  it('accepts the environment as a positional argument', async () => {
    const command = new EnvSet(
      [
        'development',
        '--name',
        'TEST_VAR',
        '--value',
        'test-value',
        '--visibility',
        'plaintext',
        '--scope',
        'project',
        '--non-interactive',
      ],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        name: 'TEST_VAR',
        value: 'test-value',
        environments: [DefaultEnvironment.Development],
        visibility: EnvironmentVariableVisibility.Public,
        type: EnvironmentSecretType.String,
      },
      testProjectId
    );
  });

  it('prompts for missing arguments', async () => {
    const command = new EnvSet([], mockConfig);

    jest.mocked(promptVariableNameAsync).mockImplementation(async () => 'VarName');
    jest.mocked(promptVariableValueAsync).mockImplementation(async () => 'VarValue');
    jest
      .mocked(promptVariableTypeAsync)
      .mockImplementation(async () => EnvironmentSecretType.String);

    jest
      .mocked(promptVariableEnvironmentAsync)
      // @ts-expect-error
      .mockImplementation(async () => [DefaultEnvironment.Production]);

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(promptVariableNameAsync).toHaveBeenCalled();
    expect(promptVariableValueAsync).toHaveBeenCalled();
    expect(promptVariableEnvironmentAsync).toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        name: 'VarName',
        value: 'VarValue',
        environments: [DefaultEnvironment.Production],
        visibility: EnvironmentVariableVisibility.Public,
        type: EnvironmentSecretType.String,
      },
      testProjectId
    );
  });

  it('preserves the file type when updating a file variable with --value but no --type', async () => {
    const testFilePath = '/path/to/creds.json';
    const testFileBase64 = 'dGVzdCBmaWxlIGNvbnRlbnQ=';
    const testFileName = 'creds.json';
    const otherVariableId = 'otherId';

    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      // @ts-expect-error
      .mockImplementation(async () => [
        {
          id: otherVariableId,
          name: 'VarName',
          environments: [DefaultEnvironment.Production],
          scope: EnvironmentVariableScope.Project,
          type: EnvironmentSecretType.FileBase64,
        },
      ]);

    jest.mocked(fs.pathExists).mockImplementation(() => Promise.resolve(true));
    jest.mocked(fs.readFile).mockImplementation(() => Promise.resolve(testFileBase64));

    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        testFilePath,
        '--environment',
        'production',
        '--visibility',
        'secret',
        '--non-interactive',
      ],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(fs.pathExists).toHaveBeenCalledWith(testFilePath);
    expect(fs.readFile).toHaveBeenCalledWith(testFilePath, 'base64');
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
      id: otherVariableId,
      name: 'VarName',
      value: testFileBase64,
      visibility: EnvironmentVariableVisibility.Secret,
      environments: [DefaultEnvironment.Production],
      type: EnvironmentSecretType.FileBase64,
      fileName: testFileName,
    });
  });

  it('throws when updating a file variable with a value that is not a valid file path and no --type', async () => {
    const plainStringValue = 'some-new-value';
    const otherVariableId = 'otherId';

    jest
      .mocked(EnvironmentVariablesQuery.byAppIdAsync)
      // @ts-expect-error
      .mockImplementation(async () => [
        {
          id: otherVariableId,
          name: 'VarName',
          environments: [DefaultEnvironment.Production],
          scope: EnvironmentVariableScope.Project,
          type: EnvironmentSecretType.FileBase64,
        },
      ]);

    jest.mocked(fs.pathExists).mockImplementation(() => Promise.resolve(false));

    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        plainStringValue,
        '--environment',
        'production',
        '--visibility',
        'secret',
        '--non-interactive',
      ],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await expect(command.runAsync()).rejects.toThrow(
      `Variable "VarName" is a file type, but "${plainStringValue}" does not exist as a file. If you want to convert it to a string, pass --type string.`
    );
    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
  });

  it('outputs the created variable as JSON with --json and does not print a tick', async () => {
    const command = new EnvSet(
      [
        '--name',
        'VarName',
        '--value',
        'VarValue',
        '--environment',
        'production',
        '--visibility',
        'plaintext',
        '--json',
      ],
      mockConfig
    );

    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      loggedIn: { graphqlClient },
      projectId: testProjectId,
    });

    await command.runAsync();

    expect(enableJsonOutput).toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      {
        name: 'VarName',
        value: 'VarValue',
        environments: [DefaultEnvironment.Production],
        visibility: EnvironmentVariableVisibility.Public,
        type: EnvironmentSecretType.String,
      },
      testProjectId
    );
    expect(printJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        id: variableId,
        name: 'VarName',
        value: 'VarValue',
      })
    );
  });
});
