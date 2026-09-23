import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { loadProjectScopedEnvVarsAsync } from '../../../../environments/variables';
import { resolveAndroidFingerprintsAsync } from '../../../../integrations/detour/credentials';
import { fetchLinkVerificationAsync } from '../../../../integrations/detour/verification';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import Log from '../../../../log';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsDetourStatus from '../status';

jest.mock('fs-extra');
jest.mock('../../../../environments/variables');
jest.mock('../../../../integrations/detour/verification');
jest.mock('../../../../integrations/detour/credentials');
jest.mock('../../../../project/projectUtils');
jest.mock('../../../../log');
jest.mock('../../../../utils/json');

const appId = 'a5f2c1d0-0000-4000-8000-000000000001';
const linkHost = 'acme.godetour.link';

const connectedExp = {
  slug: 'testapp',
  name: 'testapp',
  extra: { detour: { appId, linkHost } },
  ios: { associatedDomains: [`applinks:${linkHost}`] },
  android: {
    intentFilters: [{ action: 'VIEW', data: [{ scheme: 'https', host: linkHost }] }],
  },
};

describe(IntegrationsDetourStatus, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  function createCommand(
    argv: string[] = [],
    exp: Record<string, unknown> = connectedExp
  ): IntegrationsDetourStatus {
    const command = new IntegrationsDetourStatus(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: { projectId: testProjectId, projectDir: '/project', exp },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(loadProjectScopedEnvVarsAsync).mockResolvedValue([] as never);
    jest.mocked(fetchLinkVerificationAsync).mockResolvedValue({
      assetlinks: { served: true, packageName: 'com.acme.app', fingerprints: ['AA:BB', 'CC:DD'] },
      aasa: { served: true, appIds: ['ABCDE12345.com.acme.app'] },
    });
  });

  it('reports an unconnected project without calling out to the network', async () => {
    await createCommand([], { slug: 'testapp', name: 'testapp' }).runAsync();

    expect(fetchLinkVerificationAsync).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('not connected to Detour'));
  });

  it('checks the verification files the operating systems actually fetch', async () => {
    await createCommand().runAsync();

    expect(fetchLinkVerificationAsync).toHaveBeenCalledWith(linkHost);
  });

  it('warns when a verification file is not served', async () => {
    jest.mocked(fetchLinkVerificationAsync).mockResolvedValue({
      assetlinks: { served: true, packageName: 'com.acme.app', fingerprints: ['AA:BB', 'CC:DD'] },
      aasa: { served: false, appIds: [] },
    });

    await createCommand().runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('open the browser'));
  });

  it('flags an app config that no longer declares the link host', async () => {
    await createCommand([], { ...connectedExp, ios: {}, android: {} }).runAsync();

    const printed = jest
      .mocked(Log.log)
      .mock.calls.map(call => String(call[0]))
      .join('\n');
    expect(printed).toContain('Link host');
  });

  it('spots that only the EAS keystores are published', async () => {
    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue({ name: 'acme' } as never);
    jest.mocked(resolveAndroidFingerprintsAsync).mockResolvedValue(['aabb', 'ccdd']);
    jest.mocked(fetchLinkVerificationAsync).mockResolvedValue({
      assetlinks: { served: true, packageName: 'com.acme.app', fingerprints: ['AA:BB', 'CC:DD'] },
      aasa: { served: true, appIds: ['ABCDE12345.com.acme.app'] },
    });

    await createCommand([], { ...connectedExp, android: { package: 'com.acme.app' } }).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('Play App Signing'));
  });

  it('stays quiet when something beyond the EAS keystores is published', async () => {
    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue({ name: 'acme' } as never);
    jest.mocked(resolveAndroidFingerprintsAsync).mockResolvedValue(['aabb']);
    jest.mocked(fetchLinkVerificationAsync).mockResolvedValue({
      assetlinks: { served: true, packageName: 'com.acme.app', fingerprints: ['AA:BB', 'EE:FF'] },
      aasa: { served: true, appIds: ['ABCDE12345.com.acme.app'] },
    });

    await createCommand([], { ...connectedExp, android: { package: 'com.acme.app' } }).runAsync();

    expect(Log.warn).not.toHaveBeenCalledWith(expect.stringContaining('Play App Signing'));
  });

  it('emits the whole picture as JSON', async () => {
    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({ connected: true, appId, linkHost })
    );
  });
});
