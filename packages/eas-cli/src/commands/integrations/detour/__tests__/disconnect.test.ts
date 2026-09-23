import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { loadProjectScopedEnvVarsAsync } from '../../../../environments/variables';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvironmentVariableMutation } from '../../../../graphql/mutations/EnvironmentVariableMutation';
import { removeEnvLocalKeysAsync } from '../../../../integrations/detour/env';
import { removeFromAppConfigAsync } from '../../../../integrations/detour/linking';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsDetourDisconnect from '../disconnect';

jest.mock('../../../../environments/variables');
jest.mock('../../../../graphql/mutations/EnvironmentVariableMutation');
jest.mock('../../../../integrations/detour/env');
jest.mock('../../../../integrations/detour/linking', () => ({
  ...jest.requireActual('../../../../integrations/detour/linking'),
  removeFromAppConfigAsync: jest.fn(),
}));
jest.mock('../../../../log');
jest.mock('../../../../prompts');
jest.mock('../../../../utils/json');

const appId = 'a5f2c1d0-0000-4000-8000-000000000001';
const linkHost = 'acme.godetour.link';
const projectDir = '/project';

describe(IntegrationsDetourDisconnect, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  function createCommand(
    argv: string[] = [],
    extra: Record<string, unknown> = { detour: { appId, linkHost } }
  ): IntegrationsDetourDisconnect {
    const command = new IntegrationsDetourDisconnect(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        projectDir,
        exp: { slug: 'testapp', extra },
      },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(removeFromAppConfigAsync).mockResolvedValue(null);
    jest.mocked(removeEnvLocalKeysAsync).mockResolvedValue(true);
    jest.mocked(loadProjectScopedEnvVarsAsync).mockResolvedValue([{ id: 'var-1' }] as never);
  });

  it('removes the app config entries, the .env.local keys and the EAS variables', async () => {
    await createCommand(['--yes']).runAsync();

    expect(removeFromAppConfigAsync).toHaveBeenCalledWith(projectDir, { linkHost });
    expect(removeEnvLocalKeysAsync).toHaveBeenCalledWith(projectDir);
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledTimes(2);
    expect(EnvironmentVariableMutation.deleteAsync).toHaveBeenCalledWith(graphqlClient, 'var-1');
  });

  it('asks before changing anything and stops when the answer is no', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand().runAsync();

    expect(removeFromAppConfigAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
  });

  it('does not ask in non-interactive mode', async () => {
    await createCommand(['--non-interactive']).runAsync();

    expect(confirmAsync).not.toHaveBeenCalled();
    expect(removeFromAppConfigAsync).toHaveBeenCalled();
  });

  it('does nothing for a project that is not connected', async () => {
    await createCommand(['--yes'], {}).runAsync();

    expect(removeFromAppConfigAsync).not.toHaveBeenCalled();
    expect(removeEnvLocalKeysAsync).not.toHaveBeenCalled();
    expect(EnvironmentVariableMutation.deleteAsync).not.toHaveBeenCalled();
  });

  // Removing by pattern would be wrong for custom domains, so it reports instead.
  it('warns about the domain entries it cannot identify', async () => {
    await createCommand(['--yes'], { detour: { appId } }).runAsync();

    expect(removeFromAppConfigAsync).toHaveBeenCalledWith(projectDir, { linkHost: undefined });
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('by hand'));
  });

  it('passes manual steps through to --json output', async () => {
    jest.mocked(removeFromAppConfigAsync).mockResolvedValue('Remove the Detour entries');

    await createCommand(['--json', '--yes']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      appId,
      manualSteps: ['Remove the Detour entries'],
    });
  });

  it('reports an unconnected project as null in --json output', async () => {
    await createCommand(['--json', '--yes'], {}).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ appId: null });
  });
});
