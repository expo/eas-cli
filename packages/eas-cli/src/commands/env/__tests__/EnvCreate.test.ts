import { Config } from '@oclif/core';

import { getMockAppFragment } from '../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentSecretType,
  EnvironmentVariableEnvironment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import {
  parseVisibility,
  promptVariableEnvironmentAsync,
  promptVariableNameAsync,
  promptVariableTypeAsync,
  promptVariableValueAsync,
} from '../../../utils/prompts';
import EnvCreate from '../create';

jest.mock('../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../utils/prompts');

describe(EnvCreate, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;
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
      }));
    jest
      .mocked(EnvironmentVariableMutation.createSharedVariableAsync)
      .mockImplementation(async (_client, input, _appId) => ({
        ...input,
        id: variableId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Shared,
      }));
    jest
      .mocked(EnvironmentVariableMutation.updateAsync)
      .mockImplementation(async (_client, input) => ({
        ...input,
        id: variableId,
        name: 'VarName',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Shared,
        type: EnvironmentSecretType.String,
      }));
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockImplementation(async () => []);
    jest.mocked(EnvironmentVariablesQuery.sharedAsync).mockImplementation(async () => []);
  });

  describe('in interactive mode', () => {
    it('creates a project variable', async () => {
      const command = new EnvCreate(
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
          environments: [EnvironmentVariableEnvironment.Production],
          visibility: EnvironmentVariableVisibility.Secret,
          type: EnvironmentSecretType.String,
        },
        testProjectId
      );
    });

    it('updates an existing variable in the same environment', async () => {
      const command = new EnvCreate(
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
            environments: [EnvironmentVariableEnvironment.Production],
            scope: EnvironmentVariableScope.Project,
          },
        ]);

      // @ts-expect-error
      jest.spyOn(command, 'promptForOverwriteAsync').mockResolvedValue(true);
      jest
        .mocked(EnvironmentVariableMutation.updateAsync)
        // @ts-expect-error
        .mockImplementation(async (_client, input) => ({
          ...input,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          scope: EnvironmentVariableScope.Project,
        }));

      await command.runAsync();

      expect(EnvironmentVariablesQuery.byAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
        appId: testProjectId,
        filterNames: ['VarName'],
      });

      expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
        id: otherVariableId,
        name: 'VarName',
        value: 'VarValue',
        environments: [EnvironmentVariableEnvironment.Production],
        visibility: EnvironmentVariableVisibility.Secret,
      });
    });

    it('creates an account-wide variable', async () => {
      const command = new EnvCreate(
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
        privateProjectConfig: { projectId: testProjectId },
      });

      await command.runAsync();

      expect(EnvironmentVariableMutation.createSharedVariableAsync).toHaveBeenCalledWith(
        graphqlClient,
        {
          name: 'VarName',
          value: 'VarValue',
          isGlobal: true,
          environments: [EnvironmentVariableEnvironment.Production],
          visibility: EnvironmentVariableVisibility.Public,
          type: EnvironmentSecretType.String,
        },
        'test-account-id'
      );
    });

    it('throws if an account-wide variable already exists', async () => {
      const command = new EnvCreate(
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
        privateProjectConfig: { projectId: testProjectId },
      });

      jest
        .mocked(EnvironmentVariablesQuery.sharedAsync)
        // @ts-expect-error
        .mockImplementation(async () => [
          {
            id: 'otherId',
            environments: [EnvironmentVariableEnvironment.Production],
            scope: EnvironmentVariableScope.Shared,
          },
        ]);

      await expect(command.runAsync()).rejects.toThrow();
    });

    it('updates if an account-wide variable already exists and --force flag is set', async () => {
      const command = new EnvCreate(
        [
          '--name',
          'VarName',
          '--value',
          'VarValue',
          '--environment',
          'production',
          '--force',
          '--scope',
          'account',
        ],
        mockConfig
      );

      const otherVariableId = 'otherId';

      // @ts-expect-error
      jest.spyOn(command, 'getContextAsync').mockReturnValue({
        loggedIn: { graphqlClient },
        privateProjectConfig: { projectId: testProjectId },
      });

      jest
        .mocked(EnvironmentVariablesQuery.sharedAsync)
        // @ts-expect-error
        .mockImplementation(async () => [
          {
            id: otherVariableId,
            environments: [EnvironmentVariableEnvironment.Production],
            scope: EnvironmentVariableScope.Shared,
          },
        ]);

      await command.runAsync();

      expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
        id: otherVariableId,
        name: 'VarName',
        value: 'VarValue',
        environments: [EnvironmentVariableEnvironment.Production],
        visibility: EnvironmentVariableVisibility.Public,
      });
    });

    it('creates an account-wide variable and links it', async () => {
      const command = new EnvCreate(
        [
          '--name',
          'VarName',
          '--value',
          'VarValue',
          '--environment',
          'production',
          '--environment',
          'development',
          '--scope',
          'account',
          '--link',
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
          environments: [
            EnvironmentVariableEnvironment.Production,
            EnvironmentVariableEnvironment.Development,
          ],
          visibility: EnvironmentVariableVisibility.Public,
          isGlobal: true,
          type: EnvironmentSecretType.String,
        },
        testAccountId
      );
      expect(EnvironmentVariableMutation.linkSharedEnvironmentVariableAsync).toHaveBeenCalledWith(
        graphqlClient,
        'testId',
        testProjectId,
        EnvironmentVariableEnvironment.Production
      );
      expect(EnvironmentVariableMutation.linkSharedEnvironmentVariableAsync).toHaveBeenCalledWith(
        graphqlClient,
        'testId',
        testProjectId,
        EnvironmentVariableEnvironment.Development
      );
    });

    it('prompts for missing arguments', async () => {
      const command = new EnvCreate([], mockConfig);

      jest.mocked(promptVariableNameAsync).mockImplementation(async () => 'VarName');
      jest.mocked(promptVariableValueAsync).mockImplementation(async () => 'VarValue');
      jest
        .mocked(promptVariableTypeAsync)
        .mockImplementation(async () => EnvironmentSecretType.String);

      jest
        .mocked(promptVariableEnvironmentAsync)
        // @ts-expect-error
        .mockImplementation(async () => [EnvironmentVariableEnvironment.Production]);

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
          environments: [EnvironmentVariableEnvironment.Production],
          visibility: EnvironmentVariableVisibility.Public,
          type: EnvironmentSecretType.String,
        },
        testProjectId
      );
    });
  });
});
