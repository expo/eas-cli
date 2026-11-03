import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { loadProjectScopedEnvVarsAsync } from '../../../../environments/variables';
import { EnvironmentVariableMutation } from '../../../../graphql/mutations/EnvironmentVariableMutation';
import {
  hasEnvLocalKeysAsync,
  removeEnvLocalKeysAsync,
} from '../../../../integrations/surrealdb/env';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsSurrealdbDisconnect from '../disconnect';

jest.mock('../../../../environments/variables');
jest.mock('../../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../../integrations/surrealdb/env', () => ({
  ...jest.requireActual('../../../../integrations/surrealdb/env'),
  hasEnvLocalKeysAsync: jest.fn(),
  removeEnvLocalKeysAsync: jest.fn(),
}));
jest.mock('../../../../log');
jest.mock('../../../../prompts');
jest.mock('../../../../utils/json');

const projectDir = '/project';

describe(IntegrationsSurrealdbDisconnect, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  function createCommand(argv: string[] = []): IntegrationsSurrealdbDisconnect {
    const command = new IntegrationsSurrealdbDisconnect(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: { projectId: testProjectId, projectDir, exp: { slug: 'testapp' } },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(hasEnvLocalKeysAsync).mockResolvedValue(true);
    jest.mocked(removeEnvLocalKeysAsync).mockResolvedValue(true);
    jest
      .mocked(loadProjectScopedEnvVarsAsync)
      .mockImplementation((async (_client: unknown, _projectId: string, name: string) => [
        { id: `${name}-id`, name, environments: ['production'] },
      ]) as any);
  });

  it('removes the .env.local keys and every EAS variable', async () => {
    await createCommand(['--yes']).runAsync();

    expect(removeEnvLocalKeysAsync).toHaveBeenCalledWith(projectDir);
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledTimes(3);
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(
      graphqlClient,
      'EXPO_PUBLIC_SURREAL_ENDPOINT-id'
    );
  });

  it('asks before changing anything and stops when the answer is no', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand().runAsync();

    expect(removeEnvLocalKeysAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
  });

  it('does not ask in non-interactive mode', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledTimes(3);
  });

  it('does nothing, without asking, for a project that is not connected', async () => {
    jest.mocked(loadProjectScopedEnvVarsAsync).mockResolvedValue([]);
    jest.mocked(hasEnvLocalKeysAsync).mockResolvedValue(false);

    await createCommand().runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(removeEnvLocalKeysAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('is not connected to SurrealDB'));
  });

  it('still cleans up .env.local when EAS has no variables', async () => {
    jest.mocked(loadProjectScopedEnvVarsAsync).mockResolvedValue([]);

    await createCommand(['--yes']).runAsync();

    expect(removeEnvLocalKeysAsync).toHaveBeenCalledWith(projectDir);
    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
  });

  it('reports what was removed with --json', async () => {
    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      envLocalRemoved: true,
      deletedEnvironmentVariables: [
        {
          id: 'EXPO_PUBLIC_SURREAL_ENDPOINT-id',
          name: 'EXPO_PUBLIC_SURREAL_ENDPOINT',
          environments: ['production'],
        },
        {
          id: 'EXPO_PUBLIC_SURREAL_NAMESPACE-id',
          name: 'EXPO_PUBLIC_SURREAL_NAMESPACE',
          environments: ['production'],
        },
        {
          id: 'EXPO_PUBLIC_SURREAL_DATABASE-id',
          name: 'EXPO_PUBLIC_SURREAL_DATABASE',
          environments: ['production'],
        },
      ],
    });
  });
});
