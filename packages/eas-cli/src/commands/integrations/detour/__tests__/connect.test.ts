import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { resolveTargetEnvironmentsAsync } from '../../../../environments/resolve';
import { upsertEnvVarAsync } from '../../../../environments/variables';
import { DefaultEnvironment } from '../../../../build/utils/environment';
import { UserQuery } from '../../../../graphql/queries/UserQuery';
import {
  authorizeAsync,
  createAppAsync,
  findAppAsync,
  listAppsAsync,
  updateSigningIdentityAsync,
} from '../../../../integrations/detour/api';
import { collectSigningIdentityAsync } from '../../../../integrations/detour/credentials';
import {
  removeFromAppConfigAsync,
  updateAppConfigAsync,
} from '../../../../integrations/detour/linking';
import { writeEnvLocalAsync } from '../../../../integrations/shared/envFile';
import { installSdkPackagesAsync } from '../../../../integrations/shared/sdk';
import Log from '../../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../../../prompts';
import { printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsDetourConnect from '../connect';

jest.mock('../../../../environments/resolve', () => ({
  ...jest.requireActual('../../../../environments/resolve'),
  resolveTargetEnvironmentsAsync: jest.fn(),
}));
jest.mock('../../../../environments/variables');
jest.mock('../../../../graphql/queries/UserQuery');
jest.mock('../../../../integrations/detour/api', () => ({
  ...jest.requireActual('../../../../integrations/detour/api'),
  authorizeAsync: jest.fn(),
  createAppAsync: jest.fn(),
  findAppAsync: jest.fn(),
  listAppsAsync: jest.fn(),
  updateSigningIdentityAsync: jest.fn(),
}));
jest.mock('../../../../integrations/detour/credentials');
jest.mock('../../../../integrations/detour/linking', () => ({
  ...jest.requireActual('../../../../integrations/detour/linking'),
  removeFromAppConfigAsync: jest.fn(),
  updateAppConfigAsync: jest.fn(),
}));
jest.mock('../../../../integrations/shared/envFile');
jest.mock('../../../../integrations/shared/sdk');
jest.mock('../../../../project/projectUtils');
jest.mock('../../../../prompts');
jest.mock('../../../../utils/json');
jest.mock('../../../../log', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), newLine: jest.fn(), withTick: jest.fn() },
  link: (url: string) => url,
}));

const appId = 'a5f2c1d0-0000-4000-8000-000000000001';
const linkHost = 'acme.godetour.link';
const deviceCode = 'device-code-secret';

const detourApp = {
  appId,
  name: 'testapp',
  apiKey: 'pk_test',
  linkHost,
  dashboardUrl: `https://acme.godetour.dev/applications/${appId}`,
};

describe(IntegrationsDetourConnect, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  function createCommand(
    argv: string[] = [],
    exp: Record<string, unknown> = { slug: 'testapp', name: 'testapp' }
  ): IntegrationsDetourConnect {
    const command = new IntegrationsDetourConnect(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: { projectId: testProjectId, projectDir: '/project', exp },
      loggedIn: { graphqlClient },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(resolveTargetEnvironmentsAsync).mockResolvedValue([DefaultEnvironment.Production]);
    jest
      .mocked(UserQuery.currentUserAsync)
      .mockResolvedValue({ email: 'dev@example.com' } as never);
    jest.mocked(authorizeAsync).mockResolvedValue({ deviceCode } as never);
    jest.mocked(createAppAsync).mockResolvedValue(detourApp);
    jest.mocked(findAppAsync).mockResolvedValue(detourApp);
    jest
      .mocked(updateSigningIdentityAsync)
      .mockResolvedValue({ missing: [], publishFailed: false });
    jest.mocked(collectSigningIdentityAsync).mockResolvedValue({});
    jest.mocked(updateAppConfigAsync).mockResolvedValue(null);
    jest.mocked(removeFromAppConfigAsync).mockResolvedValue(null);
    jest.mocked(installSdkPackagesAsync).mockResolvedValue(true as never);
    jest.mocked(writeEnvLocalAsync).mockResolvedValue(undefined as never);
    jest.mocked(upsertEnvVarAsync).mockResolvedValue(undefined as never);
    jest
      .mocked(getOwnerAccountForProjectIdAsync)
      .mockResolvedValue({ name: 'acme-account' } as never);
    jest.mocked(confirmAsync).mockResolvedValue(false);
    jest.mocked(listAppsAsync).mockResolvedValue([]);
  });

  it('creates an app and writes the link host into the app config', async () => {
    await createCommand().runAsync();

    expect(createAppAsync).toHaveBeenCalledWith(deviceCode, 'testapp');
    expect(updateAppConfigAsync).toHaveBeenCalledWith('/project', { linkHost, appId });
    // Twice would print "Added ..." and then "App config already links ...".
    expect(updateAppConfigAsync).toHaveBeenCalledTimes(1);
  });

  it('offers the apps already in the organization before creating one', async () => {
    jest.mocked(listAppsAsync).mockResolvedValue([
      { appId: 'other-id', name: 'other' },
      { appId, name: 'testapp' },
    ]);
    jest.mocked(selectAsync).mockResolvedValue(appId as never);

    await createCommand().runAsync();

    expect(createAppAsync).not.toHaveBeenCalled();
    expect(findAppAsync).toHaveBeenCalledWith(deviceCode, appId);
  });

  it('puts the app named after the project first', async () => {
    jest.mocked(listAppsAsync).mockResolvedValue([
      { appId: 'other-id', name: 'other' },
      { appId, name: 'testapp' },
    ]);
    jest.mocked(selectAsync).mockResolvedValue(appId as never);

    await createCommand().runAsync();

    const choices = jest.mocked(selectAsync).mock.calls[0][1];
    expect(choices[0]).toEqual(expect.objectContaining({ value: appId }));
  });

  it('creates an app when the organization has none', async () => {
    await createCommand().runAsync();

    expect(selectAsync).not.toHaveBeenCalled();
    expect(createAppAsync).toHaveBeenCalledWith(deviceCode, 'testapp');
  });

  it('reuses the app recorded in the app config instead of creating a second one', async () => {
    await createCommand([], {
      slug: 'testapp',
      name: 'testapp',
      extra: { detour: { appId, linkHost } },
    }).runAsync();

    expect(findAppAsync).toHaveBeenCalledWith(deviceCode, appId);
    expect(createAppAsync).not.toHaveBeenCalled();
  });

  it('stops when the recorded app is not in the approved organization', async () => {
    jest.mocked(findAppAsync).mockResolvedValue(null);

    await expect(
      createCommand([], {
        slug: 'testapp',
        name: 'testapp',
        extra: { detour: { appId, linkHost } },
      }).runAsync()
    ).rejects.toThrow('already connected to Detour app');

    expect(createAppAsync).not.toHaveBeenCalled();
    expect(updateAppConfigAsync).not.toHaveBeenCalled();
  });

  it('skips the browser approval entirely when given an app id and key', async () => {
    await createCommand(['--app-id', appId, '--api-key', 'pk_manual']).runAsync();

    expect(authorizeAsync).not.toHaveBeenCalled();
    expect(createAppAsync).not.toHaveBeenCalled();
    expect(updateSigningIdentityAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('app.json snippets'));
  });

  // They travel with the signing identity, which the flags path never sends.
  it('refuses an identity flag alongside --app-id instead of ignoring it', async () => {
    await expect(
      createCommand([
        '--app-id',
        appId,
        '--api-key',
        'pk_manual',
        '--play-signing-cert',
        'AA'.repeat(32),
      ]).runAsync()
    ).rejects.toThrow(/cannot also be provided|exclusive/i);
  });

  it('leaves the app config alone with --skip-app-config', async () => {
    await createCommand(['--skip-app-config']).runAsync();

    expect(updateAppConfigAsync).not.toHaveBeenCalled();
  });

  it('sends the flags for what EAS could not discover', async () => {
    await createCommand([
      '--team-id',
      'ABC123DEF4',
      '--app-store-id',
      '1234567890',
      '--play-signing-cert',
      'AA'.repeat(32),
    ]).runAsync();

    expect(updateSigningIdentityAsync).toHaveBeenCalledWith(deviceCode, appId, {
      teamId: 'ABC123DEF4',
      appStoreId: '1234567890',
      productionCertificate: 'AA:'.repeat(31) + 'AA',
    });
  });

  it('prefers what EAS discovered over the flag', async () => {
    jest.mocked(collectSigningIdentityAsync).mockResolvedValue({ teamId: 'REAL12345' });

    await createCommand(['--team-id', 'ABC123DEF4']).runAsync();

    expect(updateSigningIdentityAsync).toHaveBeenCalledWith(
      deviceCode,
      appId,
      expect.objectContaining({ teamId: 'REAL12345' })
    );
  });

  it('reports the fields that are still empty after the write', async () => {
    jest
      .mocked(updateSigningIdentityAsync)
      .mockResolvedValue({ missing: ['teamId', 'productionCertificate'], publishFailed: false });

    await createCommand().runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('--team-id'));
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('--play-signing-cert'));
  });

  it('tells the user when the verification files could not be published', async () => {
    jest.mocked(updateSigningIdentityAsync).mockResolvedValue({ missing: [], publishFailed: true });

    await createCommand().runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('could not publish'));
  });

  it('replaces the entries when the app config points at an old link host', async () => {
    jest.mocked(findAppAsync).mockResolvedValue({ ...detourApp, linkHost: 'new.godetour.link' });

    await createCommand([], {
      slug: 'testapp',
      name: 'testapp',
      extra: { detour: { appId, linkHost: 'old.godetour.link' } },
    }).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('old.godetour.link'));
    expect(removeFromAppConfigAsync).toHaveBeenCalledWith('/project', {
      linkHost: 'old.godetour.link',
    });
    expect(updateAppConfigAsync).toHaveBeenCalledWith('/project', {
      linkHost: 'new.godetour.link',
      appId,
    });
  });

  it('stops before touching the project when the app has no publishable key', async () => {
    jest.mocked(findAppAsync).mockResolvedValue({ ...detourApp, apiKey: null });

    await expect(
      createCommand([], {
        slug: 'testapp',
        name: 'testapp',
        extra: { detour: { appId, linkHost } },
      }).runAsync()
    ).rejects.toThrow('no active publishable key');

    expect(installSdkPackagesAsync).not.toHaveBeenCalled();
    expect(updateAppConfigAsync).not.toHaveBeenCalled();
  });

  it('offers to collect what EAS could not discover, and writes it', async () => {
    jest
      .mocked(updateSigningIdentityAsync)
      .mockResolvedValueOnce({ missing: ['teamId'], publishFailed: false })
      .mockResolvedValueOnce({ missing: [], publishFailed: false });
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(promptAsync).mockResolvedValue({ value: 'ABCDE12345' } as never);

    await createCommand().runAsync();

    expect(updateSigningIdentityAsync).toHaveBeenLastCalledWith(deviceCode, appId, {
      teamId: 'ABCDE12345',
    });
    expect(Log.warn).not.toHaveBeenCalledWith(expect.stringContaining('--team-id'));
  });

  it('keeps the advice when the offer is declined', async () => {
    jest
      .mocked(updateSigningIdentityAsync)
      .mockResolvedValue({ missing: ['teamId'], publishFailed: false });
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await createCommand().runAsync();

    expect(updateSigningIdentityAsync).toHaveBeenCalledTimes(1);
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('--team-id'));
  });

  it('accepts a fingerprint pasted with its label', async () => {
    await createCommand(['--play-signing-cert', `SHA-256: ${'AA:'.repeat(31)}AA\n`]).runAsync();

    expect(updateSigningIdentityAsync).toHaveBeenCalledWith(
      deviceCode,
      appId,
      expect.objectContaining({ productionCertificate: `${'AA:'.repeat(31)}AA` })
    );
  });

  it('rejects a malformed fingerprint without starting the approval', async () => {
    await expect(
      createCommand(['--play-signing-cert', `${'AA:'.repeat(19)}AA`]).runAsync()
    ).rejects.toThrow('must be a SHA-256 fingerprint');

    expect(authorizeAsync).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric app store id without starting the approval', async () => {
    await expect(createCommand(['--app-store-id', 'id1234']).runAsync()).rejects.toThrow(
      'digits only'
    );

    expect(authorizeAsync).not.toHaveBeenCalled();
  });

  it('stops when the app has no publishable key to ship', async () => {
    jest.mocked(createAppAsync).mockResolvedValue({ ...detourApp, apiKey: null });

    await expect(createCommand().runAsync()).rejects.toThrow('no active publishable key');
  });

  it('reports the app and the environments it wrote to as JSON', async () => {
    await createCommand(['--json']).runAsync();

    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      app: detourApp,
      environments: [DefaultEnvironment.Production],
      manualSteps: [],
    });
  });

  it('passes the machine name and the signed-in email to the approval', async () => {
    await createCommand().runAsync();

    expect(authorizeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ emailHint: 'dev@example.com', deviceLabel: expect.any(String) })
    );
  });
});
