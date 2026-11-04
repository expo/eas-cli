import spawnAsync from '@expo/spawn-async';
import * as fs from 'fs-extra';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import {
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../../graphql/generated';
import { EnvironmentVariableMutation } from '../../../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../../../graphql/queries/EnvironmentVariablesQuery';
import { isSurrealEndpointReachableAsync } from '../../../../integrations/surrealdb/endpoint';
import Log from '../../../../log';
import { confirmAsync, promptAsync } from '../../../../prompts';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsSurrealdbConnect from '../connect';

jest.mock('@expo/spawn-async');
jest.mock('fs-extra');
jest.mock('../../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../../integrations/surrealdb/endpoint', () => ({
  ...jest.requireActual('../../../../integrations/surrealdb/endpoint'),
  isSurrealEndpointReachableAsync: jest.fn(),
}));
jest.mock('../../../../prompts');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../ora', () => ({
  ora: () => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  }),
}));

const endpoint = 'wss://my-instance.aws-euw1.surreal.cloud';
const flagArgs = ['--endpoint', endpoint, '--namespace', 'app', '--database', 'main'];

describe(IntegrationsSurrealdbConnect, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  function createCommand(argv: string[]): IntegrationsSurrealdbConnect {
    const command = new IntegrationsSurrealdbConnect(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { name: 'testapp', slug: 'testapp' },
        projectDir: '/test/project',
      },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  function createdVariables(): { name: string; value: string; environments: string[] }[] {
    return jest
      .mocked(EnvironmentVariableMutation.createForAppAsync)
      .mock.calls.map(([, input]) => input as any);
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(spawnAsync).mockResolvedValue({} as any);
    jest.mocked(fs.pathExists).mockResolvedValue(false as never);
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    jest.mocked(isSurrealEndpointReachableAsync).mockResolvedValue(true);
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([]);
    jest
      .mocked(EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync)
      .mockResolvedValue(['production', 'preview', 'development']);
    jest.mocked(EnvironmentVariableMutation.createForAppAsync).mockResolvedValue({
      id: 'env-var-1',
      scope: EnvironmentVariableScope.Project,
    } as any);
  });

  it('installs the SDK and writes the three variables to .env.local and every default environment', async () => {
    await createCommand(flagArgs).runAsync();

    expect(spawnAsync).toHaveBeenCalledWith(
      'npx',
      ['expo', 'install', 'surrealdb', 'expo-secure-store'],
      expect.objectContaining({ cwd: '/test/project' })
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/test/project/.env.local',
      `EXPO_PUBLIC_SURREAL_ENDPOINT=${endpoint}\nEXPO_PUBLIC_SURREAL_NAMESPACE=app\nEXPO_PUBLIC_SURREAL_DATABASE=main\n`
    );
    expect(createdVariables()).toEqual([
      expect.objectContaining({
        name: 'EXPO_PUBLIC_SURREAL_ENDPOINT',
        value: endpoint,
        environments: ['production', 'preview', 'development'],
        visibility: EnvironmentVariableVisibility.Public,
      }),
      expect.objectContaining({ name: 'EXPO_PUBLIC_SURREAL_NAMESPACE', value: 'app' }),
      expect.objectContaining({ name: 'EXPO_PUBLIC_SURREAL_DATABASE', value: 'main' }),
    ]);
  });

  it('prompts for missing values interactively and normalizes the endpoint', async () => {
    jest.mocked(promptAsync).mockImplementation((async (opts: any) => {
      if (opts.name === 'endpoint') {
        return { endpoint: 'my-instance.aws-euw1.surreal.cloud/rpc' };
      }
      return { value: opts.message.endsWith('namespace') ? ' app ' : 'main' };
    }) as any);

    await createCommand([]).runAsync();

    expect(promptAsync).toHaveBeenCalledTimes(3);
    expect(createdVariables().map(v => v.value)).toEqual([endpoint, 'app', 'main']);
  });

  it('requires every value in non-interactive mode, before doing anything', async () => {
    await expect(
      createCommand(['--non-interactive', '--endpoint', endpoint]).runAsync()
    ).rejects.toThrow('Pass --namespace, --database in non-interactive mode.');

    expect(spawnAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.createForAppAsync).not.toHaveBeenCalled();
  });

  it('rejects an invalid --endpoint before doing anything', async () => {
    await expect(
      createCommand([
        '--endpoint',
        'ftp://db.example.com',
        '--namespace',
        'a',
        '--database',
        'b',
      ]).runAsync()
    ).rejects.toThrow('Unsupported protocol');

    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('still writes the values when the endpoint cannot be reached from this machine', async () => {
    jest.mocked(isSurrealEndpointReachableAsync).mockResolvedValue(false);

    await createCommand([...flagArgs, '--json']).runAsync();

    expect(createdVariables()).toHaveLength(3);
    expect(printJsonOnlyOutput).toHaveBeenCalledWith(expect.objectContaining({ reachable: false }));
  });

  it('warns about cleartext endpoints', async () => {
    await createCommand([
      '--endpoint',
      'ws://10.0.2.2:8000',
      '--namespace',
      'app',
      '--database',
      'main',
    ]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('is not encrypted'));
  });

  it('with --environment, writes only those environments, keeps the others and skips .env.local', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockImplementation((async (
      _client: unknown,
      { filterNames }: { filterNames: string[] }
    ) => [
      {
        id: `existing-${filterNames[0]}`,
        name: filterNames[0],
        value: 'old',
        environments: ['production', 'preview', 'development'],
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Public,
      },
    ]) as any);

    await createCommand([...flagArgs, '--environment', 'preview', '--overwrite']).runAsync();

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.updateAsync).toHaveBeenCalledWith(graphqlClient, {
      id: 'existing-EXPO_PUBLIC_SURREAL_ENDPOINT',
      environments: ['production', 'development'],
    });
    expect(createdVariables()).toEqual([
      expect.objectContaining({ name: 'EXPO_PUBLIC_SURREAL_ENDPOINT', environments: ['preview'] }),
      expect.objectContaining({ name: 'EXPO_PUBLIC_SURREAL_NAMESPACE', environments: ['preview'] }),
      expect.objectContaining({ name: 'EXPO_PUBLIC_SURREAL_DATABASE', environments: ['preview'] }),
    ]);
  });

  it('skips existing EAS variables non-interactively without --overwrite', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdAsync).mockResolvedValue([
      {
        id: 'existing',
        name: 'EXPO_PUBLIC_SURREAL_ENDPOINT',
        value: 'wss://old.example.com',
        environments: ['production'],
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Public,
      },
    ] as any);

    await createCommand([...flagArgs, '--non-interactive']).runAsync();

    expect(EnvironmentVariableMutation.updateAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('pass --overwrite'));
  });

  it('continues and reports a manual step when the SDK install fails', async () => {
    jest.mocked(spawnAsync).mockRejectedValue(new Error('install failed'));

    await createCommand([...flagArgs, '--json']).runAsync();

    expect(createdVariables()).toHaveLength(3);
    expect(printJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        manualSteps: [
          'Run npx expo install surrealdb expo-secure-store from your project directory.',
        ],
      })
    );
  });

  it('emits JSON output with --json', async () => {
    await createCommand([...flagArgs, '--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      endpoint,
      namespace: 'app',
      database: 'main',
      reachable: true,
      environments: ['production', 'preview', 'development'],
      dashboardUrl: 'https://studio.surrealdb.com',
      envLocalWritten: true,
      environmentVariables: [
        { name: 'EXPO_PUBLIC_SURREAL_ENDPOINT', easWritten: true },
        { name: 'EXPO_PUBLIC_SURREAL_NAMESPACE', easWritten: true },
        { name: 'EXPO_PUBLIC_SURREAL_DATABASE', easWritten: true },
      ],
      manualSteps: [],
    });
  });
});
