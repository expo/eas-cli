import { vol } from 'memfs';

import { createOrModifyExpoConfigAsync } from '../../../project/expoConfig';
import { readConnection, removeFromAppConfigAsync, updateAppConfigAsync } from '../linking';

jest.mock('fs');
jest.mock('../../../project/expoConfig');
jest.mock('../../../log');

const projectDir = '/project';
const linkHost = 'acme.godetour.link';
const appId = 'a5f2c1d0-0000-4000-8000-000000000001';

function writeAppJson(expo: Record<string, any>): void {
  vol.fromJSON({ [`${projectDir}/app.json`]: JSON.stringify({ expo }, null, 2) });
}

function readAppJson(): Record<string, any> {
  return JSON.parse(vol.readFileSync(`${projectDir}/app.json`, 'utf8') as string).expo;
}

function modificationsPassed(): Record<string, any> {
  return jest.mocked(createOrModifyExpoConfigAsync).mock.calls[0][1] as Record<string, any>;
}

const detourFilter = {
  action: 'VIEW',
  autoVerify: true,
  data: [{ scheme: 'https', host: linkHost }],
  category: ['BROWSABLE', 'DEFAULT'],
};

describe(updateAppConfigAsync, () => {
  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();
    jest
      .mocked(createOrModifyExpoConfigAsync)
      .mockResolvedValue({ type: 'success', config: {} } as never);
  });

  it('adds the domain, the intent filter and the app id when none are present', async () => {
    writeAppJson({ name: 'acme' });

    await expect(updateAppConfigAsync(projectDir, { linkHost, appId })).resolves.toBeNull();

    expect(modificationsPassed()).toEqual({
      extra: { detour: { appId, linkHost } },
      ios: { associatedDomains: [`applinks:${linkHost}`] },
      android: { intentFilters: [detourFilter] },
    });
  });

  // deepmerge concatenates arrays, so an entry sent back would be duplicated.
  it('sends only the new entries, never the ones already in the config', async () => {
    writeAppJson({
      ios: { associatedDomains: [`applinks:${linkHost}`] },
      android: { intentFilters: [detourFilter] },
      extra: { eas: { projectId: 'p1' } },
    });

    await updateAppConfigAsync(projectDir, { linkHost, appId });

    const modifications = modificationsPassed();
    expect(modifications).not.toHaveProperty('ios');
    expect(modifications).not.toHaveProperty('android');
    expect(modifications.extra).toEqual({ detour: { appId, linkHost } });
  });

  it('adds only the missing half when the domain is present but the filter is not', async () => {
    writeAppJson({ ios: { associatedDomains: [`applinks:${linkHost}`] } });

    await updateAppConfigAsync(projectDir, { linkHost, appId });

    const modifications = modificationsPassed();
    expect(modifications).not.toHaveProperty('ios');
    expect(modifications.android).toEqual({ intentFilters: [detourFilter] });
  });

  it('writes nothing when the domain, the filter and the app id are all present', async () => {
    writeAppJson({
      ios: { associatedDomains: [`applinks:${linkHost}`] },
      android: { intentFilters: [detourFilter] },
      extra: { detour: { appId, linkHost } },
    });

    await expect(updateAppConfigAsync(projectDir, { linkHost, appId })).resolves.toBeNull();

    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
  });

  it('leaves a verified filter for the same host alone', async () => {
    writeAppJson({ android: { intentFilters: [detourFilter] } });

    await updateAppConfigAsync(projectDir, { linkHost, appId });

    expect(modificationsPassed()).not.toHaveProperty('android');
  });

  // However many filters name the host, nothing would ask Android to verify it.
  it('still writes the filter when the host only has an unverified one', async () => {
    writeAppJson({ android: { intentFilters: [{ action: 'VIEW', data: { host: linkHost } }] } });

    await updateAppConfigAsync(projectDir, { linkHost, appId });

    expect(modificationsPassed().android).toEqual({ intentFilters: [detourFilter] });
  });

  it('returns manual instructions when there is no app.json to write to', async () => {
    vol.fromJSON({});

    const manualStep = await updateAppConfigAsync(projectDir, { linkHost, appId });

    expect(manualStep).toContain('applinks:acme.godetour.link');
    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
  });
});

describe(removeFromAppConfigAsync, () => {
  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();
  });

  // deepmerge can only grow an array, so removal writes app.json directly.
  it('removes only the entries for the recorded host', async () => {
    writeAppJson({
      ios: { associatedDomains: [`applinks:${linkHost}`, 'applinks:kept.example.com'] },
      android: {
        intentFilters: [detourFilter, { action: 'VIEW', data: [{ host: 'kept.example.com' }] }],
      },
      extra: { eas: { projectId: 'p1' }, detour: { appId, linkHost } },
    });

    await expect(removeFromAppConfigAsync(projectDir, { linkHost })).resolves.toBeNull();

    const expo = readAppJson();
    expect(expo.ios.associatedDomains).toEqual(['applinks:kept.example.com']);
    expect(expo.android.intentFilters).toEqual([
      { action: 'VIEW', data: [{ host: 'kept.example.com' }] },
    ]);
    expect(expo.extra).toEqual({ eas: { projectId: 'p1' } });
    expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
  });

  // Guessing which domains were ours would be wrong for custom domains.
  it('drops the app id but keeps every domain when no link host was recorded', async () => {
    writeAppJson({
      ios: { associatedDomains: [`applinks:${linkHost}`] },
      android: { intentFilters: [detourFilter] },
      extra: { detour: { appId } },
    });

    await removeFromAppConfigAsync(projectDir, {});

    const expo = readAppJson();
    expect(expo.ios.associatedDomains).toEqual([`applinks:${linkHost}`]);
    expect(expo.android.intentFilters).toEqual([detourFilter]);
    expect(expo.extra).toEqual({});
  });

  it('leaves ios and android untouched when the config never had them', async () => {
    writeAppJson({ name: 'acme', extra: { detour: { appId, linkHost } } });

    await removeFromAppConfigAsync(projectDir, { linkHost });

    const expo = readAppJson();
    expect(expo).not.toHaveProperty('ios');
    expect(expo).not.toHaveProperty('android');
  });

  it('returns manual instructions when there is no app.json', async () => {
    vol.fromJSON({});

    await expect(removeFromAppConfigAsync(projectDir, { linkHost })).resolves.toContain(
      'Remove the Detour entries'
    );
  });
});

describe(readConnection, () => {
  it('reads the app id and the link host', () => {
    expect(readConnection({ extra: { detour: { appId, linkHost } } } as never)).toEqual({
      appId,
      linkHost,
    });
  });

  it('treats a connection without a link host as connected', () => {
    expect(readConnection({ extra: { detour: { appId } } } as never)).toEqual({
      appId,
      linkHost: undefined,
    });
  });

  it('returns undefined when there is no app id to use', () => {
    expect(readConnection({} as never)).toBeUndefined();
    expect(readConnection({ extra: {} } as never)).toBeUndefined();
    expect(readConnection({ extra: { detour: { appId: 42 } } } as never)).toBeUndefined();
  });
});
