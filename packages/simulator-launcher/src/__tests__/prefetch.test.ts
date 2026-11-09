import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mainAsync } from '../main';
import { commands } from '../utils/processes';
import { deferred, until } from './helpers';

jest.mock('../utils/processes');

const platform = process.platform;
const expoGoUrl = 'https://example.test/Expo-Go-58.0.7.tar.gz';
const olderExpoGoUrl = 'https://example.test/Expo-Go-57.0.9.tar.gz';
let environment: NodeJS.ProcessEnv;
let home: string;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(commands.runOwnedAsync).mockResolvedValue('1.0.0\n');
  jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  environment = { ...process.env };
  process.env.SERVE_SIM_VERSION = '0.13.3';
  process.env.AGENT_DEVICE_VERSION = '0.21.36';
  process.env.ARGENT_VERSION = '0.32.0';
  process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO = '0';
  for (const name of [
    'APPIUM_VERSION',
    'XCUITEST_VERSION',
    'APPIUM_HOME',
    'npm_config_cache',
    'EXPO_GO_SDK_VERSION',
  ]) {
    delete process.env[name];
  }
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'prefetch-home-'));
  jest.spyOn(os, 'homedir').mockReturnValue(home);
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = environment;
  Object.defineProperty(process, 'platform', { value: platform });
  fs.rmSync(home, { recursive: true, force: true });
});

const cacheDirectory = (name: string): string =>
  path.join(home, 'Library', 'Caches', 'expo-simulator-startup', name);

const readPreparedManifest = () =>
  JSON.parse(fs.readFileSync(cacheDirectory('prepared.json'), 'utf8'));

/** Serves the versions API and the archive bytes at `expoGoUrl`. */
function serveExpoGo(archive: Response = new Response('expo go archive')): void {
  jest.mocked(fetch).mockImplementation(async url =>
    url === 'https://api.expo.dev/v2/versions'
      ? Response.json({
          sdkVersions: {
            '20.0.0': { releaseNoteUrl: 'https://example.test/20' },
            '57.0.0': { releaseNoteUrl: 'https://example.test/57', iosClientUrl: olderExpoGoUrl },
            '58.0.0': { releaseNoteUrl: 'https://example.test/58', iosClientUrl: expoGoUrl },
          },
        })
      : archive
  );
}

function pinAppium(): { appiumHome: string; appium: string; wda: string } {
  process.env.APPIUM_VERSION = '3.9.0';
  process.env.XCUITEST_VERSION = '12.22.8';
  const appiumHome = cacheDirectory('appium');
  return {
    appiumHome,
    appium: path.join(appiumHome, 'node_modules', '.bin', 'appium'),
    wda: path.join(appiumHome, 'preinstalled-wda'),
  };
}

test('prefetch does not inspect, install or record runtime CLI packages', async () => {
  process.env.SERVE_SIM_VERSION = 'latest';
  process.env.AGENT_DEVICE_VERSION = '^0.21';
  process.env.ARGENT_VERSION = 'invalid runtime selection';
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(commands.runOwnedAsync).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(output).not.toHaveBeenCalled();
  expect(readPreparedManifest()).toEqual({ tools: {} });
});

test('replaces old CLI metadata on rerun without removing incidental Bun caches', async () => {
  fs.mkdirSync(path.dirname(cacheDirectory('prepared.json')), { recursive: true });
  fs.writeFileSync(
    cacheDirectory('prepared.json'),
    JSON.stringify({ tools: { 'serve-sim': { version: '0.13.3' } } })
  );
  const bun = path.join(home, '.bun/install/cache');
  fs.mkdirSync(bun, { recursive: true });
  fs.writeFileSync(path.join(bun, 'retained'), 'native-warmup package cache');
  await mainAsync(['prefetch']);
  expect(readPreparedManifest()).toEqual({ tools: {} });
  expect(fs.readFileSync(path.join(bun, 'retained'), 'utf8')).toBe('native-warmup package cache');
});

test('invalidates an older manifest before work and publishes nothing after failure', async () => {
  await mainAsync(['prefetch']);
  pinAppium();
  jest.mocked(commands.runOwnedAsync).mockImplementation(async () => {
    expect(fs.existsSync(cacheDirectory('prepared.json'))).toBe(false);
    throw new Error('package setup failed');
  });
  await expect(mainAsync(['prefetch'])).rejects.toThrow('package setup failed');
  expect(fs.existsSync(cacheDirectory('prepared.json'))).toBe(false);
});

test('removes an incomplete manifest if its write fails', async () => {
  const manifestPath = cacheDirectory('prepared.json');
  jest.spyOn(fsPromises, 'writeFile').mockImplementationOnce(async file => {
    fs.writeFileSync(String(file), '{');
    throw new Error('manifest write failed');
  });
  await expect(mainAsync(['prefetch'])).rejects.toThrow('manifest write failed');
  expect(fs.existsSync(manifestPath)).toBe(false);
});

test('removes the manifest when interrupted during its final write', async () => {
  const writeFile = fsPromises.writeFile;
  jest.spyOn(fsPromises, 'writeFile').mockImplementationOnce(async (...args) => {
    await writeFile(...args);
    process.emit('SIGTERM', 'SIGTERM');
  });
  await expect(mainAsync(['prefetch'])).rejects.toThrow('Simulator prefetch was interrupted.');
  expect(fs.existsSync(cacheDirectory('prepared.json'))).toBe(false);
});

test('prefetch prepares Appium in a throwaway TMPDIR and removes it', async () => {
  const { wda } = pinAppium();
  const tmpdirs: string[] = [];
  const existed: boolean[] = [];
  jest.mocked(commands.runOwnedAsync).mockImplementation(async (_file, args) => {
    if (args.includes('download-wda')) {
      fs.mkdirSync(path.join(wda, 'WebDriverAgentRunner-Runner.app'), { recursive: true });
    }
    tmpdirs.push(process.env.TMPDIR ?? '');
    existed.push(fs.existsSync(process.env.TMPDIR ?? ''));
    return '1.0.0\n';
  });
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(existed).toEqual([true, true, true]);
  expect(new Set(tmpdirs).size).toBe(1);
  expect(path.dirname(tmpdirs[0])).toBe(os.tmpdir());
  expect(path.basename(tmpdirs[0])).toMatch(/^simulator-launcher-prefetch-/);
  expect(fs.existsSync(tmpdirs[0])).toBe(false);
});

test('prefetch stops after the first failed Appium step and removes its TMPDIR', async () => {
  pinAppium();
  let tmpdir = '';
  jest
    .mocked(commands.runOwnedAsync)
    .mockImplementationOnce(async () => {
      tmpdir = process.env.TMPDIR ?? '';
      return '0.13.3\n';
    })
    .mockRejectedValueOnce(Object.assign(new Error('bunx exited with 1.'), { code: 1 }));
  await expect(mainAsync(['prefetch'])).rejects.toThrow(
    /Could not prefetch xcuitest@12\.22\.8: bunx exited with 1\./
  );
  expect(commands.runOwnedAsync).toHaveBeenCalledTimes(2);
  expect(tmpdir).toMatch(/simulator-launcher-prefetch-/);
  expect(fs.existsSync(tmpdir)).toBe(false);
});

test('prefetch reports a timed-out Appium step', async () => {
  pinAppium();
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
  jest
    .mocked(commands.runOwnedAsync)
    .mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    );
  await expect(mainAsync(['prefetch'])).rejects.toThrow(
    /Could not prefetch appium@3\.9\.0 within 300 seconds\./
  );
  expect(commands.runOwnedAsync).toHaveBeenCalledTimes(1);
});

test.each(['SIGINT', 'SIGTERM'] as const)(
  'standalone prefetch drains before failing on %s',
  async event => {
    pinAppium();
    let tmpdir = '';
    const listeners = process.listenerCount(event);
    jest.mocked(commands.runOwnedAsync).mockImplementation(async (_file, _args, signal) => {
      tmpdir = process.env.TMPDIR!;
      return await new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      );
    });
    const result = mainAsync(['prefetch']).catch(error => error);
    await until(() => !!tmpdir);
    expect(fs.existsSync(tmpdir)).toBe(true);
    process.emit(event, event);
    expect(await result).toMatchObject({
      message: 'Could not prefetch appium@3.9.0: Simulator prefetch was interrupted.',
    });
    expect(fs.existsSync(tmpdir)).toBe(false);
    expect(process.listenerCount(event)).toBe(listeners);
  }
);

test('interruption during final cleanup cannot report success', async () => {
  const entered = deferred();
  const release = deferred();
  const rm = fsPromises.rm.bind(fsPromises);
  let tmpdir = '';
  jest.spyOn(fsPromises, 'rm').mockImplementation(async (target, options) => {
    if (String(target).includes('simulator-launcher-prefetch-')) {
      tmpdir = String(target);
      entered.resolve();
      await release.promise;
    }
    await rm(target, options);
  });
  const result = mainAsync(['prefetch']).catch(error => error);
  try {
    await entered.promise;
    expect(fs.existsSync(tmpdir)).toBe(true);
    process.emit('SIGTERM', 'SIGTERM');
    release.resolve();
    expect(await result).toMatchObject({ message: 'Simulator prefetch was interrupted.' });
    expect(fs.existsSync(tmpdir)).toBe(false);
  } finally {
    release.resolve();
    await result;
  }
});

test.each([false, true])('prefetch restores its environment after failure=%s', async fail => {
  const { wda } = pinAppium();
  jest.mocked(commands.runOwnedAsync).mockImplementation(async (_file, args) => {
    if (args.includes('download-wda')) {
      fs.mkdirSync(path.join(wda, 'WebDriverAgentRunner-Runner.app'), { recursive: true });
    }
    return '';
  });
  process.env.TMPDIR = os.tmpdir();
  process.env.APPIUM_HOME = '/previous/appium';
  delete process.env.npm_config_cache;
  if (fail) {
    jest.mocked(commands.runOwnedAsync).mockRejectedValueOnce(new Error('failed'));
    await expect(mainAsync(['prefetch'])).rejects.toThrow('failed');
  } else {
    await mainAsync(['prefetch']);
  }
  expect(process.env.TMPDIR).toBe(os.tmpdir());
  expect(process.env.APPIUM_HOME).toBe('/previous/appium');
  expect(process.env.npm_config_cache).toBeUndefined();
});

test('prefetch bounds archive validation and extraction with the step signal', async () => {
  delete process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO;
  serveExpoGo();
  jest.mocked(commands.runOwnedAsync).mockImplementation(async (file, _args, signal) => {
    if (file === '/usr/bin/gzip') {
      expect(signal).toBeInstanceOf(AbortSignal);
      throw new Error('extractor cancelled');
    }
    return '';
  });
  await expect(mainAsync(['prefetch'])).rejects.toThrow('extractor cancelled');
  expect(fs.existsSync(cacheDirectory('expo-go'))).toBe(false);
});

test('prefetch rejects extra arguments before any native work', async () => {
  await expect(mainAsync(['prefetch', 'x'])).rejects.toThrow(/Usage: .*\|prefetch>/);
  expect(commands.runOwnedAsync).not.toHaveBeenCalled();
});

test('prefetch skips Expo Go and Appium when they are turned off and removes older files', async () => {
  for (const name of ['expo-go', 'appium']) {
    fs.mkdirSync(cacheDirectory(name), { recursive: true });
    fs.writeFileSync(path.join(cacheDirectory(name), 'old'), 'old');
  }
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(process.stderr.write).toHaveBeenCalledWith(
    'Skipping Expo Go: EXPO_SIMULATOR_PREINSTALL_EXPO_GO=0.\n'
  );
  expect(process.stderr.write).toHaveBeenCalledWith(
    'Skipping Appium: APPIUM_VERSION and XCUITEST_VERSION are not set.\n'
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(fs.readdirSync(path.dirname(cacheDirectory('appium')))).toEqual(['prepared.json']);
});

test('prefetch stores the selected Expo Go archive', async () => {
  delete process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO;
  serveExpoGo();
  const expoGo = cacheDirectory('expo-go');
  fs.mkdirSync(expoGo, { recursive: true });
  fs.writeFileSync(path.join(expoGo, 'stale.tar.gz'), 'stale');
  let tmpdir = '';
  jest.mocked(commands.runOwnedAsync).mockImplementation(async (file, args) => {
    tmpdir = process.env.TMPDIR ?? '';
    if (file === '/usr/bin/tar') {
      fs.writeFileSync(path.join(args[3], 'Info.plist'), '<plist/>');
    }
    return '1.0.0\n';
  });
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  expect(await mainAsync(['prefetch'])).toBe(0);
  const file = path.join(expoGo, `${createHash('sha256').update(expoGoUrl).digest('hex')}.tar.gz`);
  expect(fs.readdirSync(expoGo)).toEqual([path.basename(file)]);
  expect(fs.readFileSync(file, 'utf8')).toBe('expo go archive');
  expect(jest.mocked(commands.runOwnedAsync).mock.calls).toEqual([
    ['/usr/bin/gzip', ['-t', file], expect.any(AbortSignal)],
    [
      '/usr/bin/tar',
      ['-xzf', file, '-C', path.join(tmpdir, 'ExpoGo.app')],
      expect.any(AbortSignal),
    ],
  ]);
  expect(path.basename(tmpdir)).toMatch(/^simulator-launcher-prefetch-/);
  expect(process.stderr.write).toHaveBeenCalledWith(
    `Prefetched Expo Go (SDK 58.0.0 from ${expoGoUrl}).\n`
  );
  expect(output).not.toHaveBeenCalled();
  expect(readPreparedManifest().tools['expo-go']).toEqual({ sdk: '58.0.0', url: expoGoUrl });
});

test.each(['archive HTTP 500', 'gzip -t fails', 'no Info.plist'])(
  'prefetch removes the Expo Go cache after %s',
  async kind => {
    delete process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO;
    serveExpoGo(kind === 'archive HTTP 500' ? new Response('', { status: 500 }) : undefined);
    jest.mocked(commands.runOwnedAsync).mockImplementation(async (file, args) => {
      if (file === '/usr/bin/gzip' && kind === 'gzip -t fails') {
        throw Object.assign(new Error('/usr/bin/gzip exited with 1.'), { code: 1 });
      }
      if (file === '/usr/bin/tar' && kind !== 'no Info.plist') {
        fs.writeFileSync(path.join(args[3], 'Info.plist'), '<plist/>');
      }
      return '1.0.0\n';
    });
    await expect(mainAsync(['prefetch'])).rejects.toThrow(/Could not prefetch Expo Go: /);
    expect(fs.existsSync(cacheDirectory('expo-go'))).toBe(false);
  }
);

test('prefetch prepares the pinned Appium home and writes the shared manifest last', async () => {
  const { appiumHome, appium, wda } = pinAppium();
  let tmpdir = '';
  const seen: { APPIUM_HOME?: string; npm_config_cache?: string; prepared: boolean }[] = [];
  jest.mocked(commands.runOwnedAsync).mockImplementation(async (file, args) => {
    tmpdir = process.env.TMPDIR ?? '';
    seen.push({
      APPIUM_HOME: process.env.APPIUM_HOME,
      npm_config_cache: process.env.npm_config_cache,
      prepared: fs.existsSync(cacheDirectory('prepared.json')),
    });
    if (file === 'npm') {
      fs.mkdirSync(path.dirname(appium), { recursive: true });
      fs.writeFileSync(appium, '');
    }
    if (args.includes('download-wda')) {
      fs.mkdirSync(path.join(wda, 'WebDriverAgentRunner-Runner.app'), { recursive: true });
    }
    return '1.0.0\n';
  });
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(jest.mocked(commands.runOwnedAsync).mock.calls).toEqual([
    [
      'npm',
      ['install', '--no-audit', '--save-exact', '--prefix', appiumHome, 'appium@3.9.0'],
      expect.any(AbortSignal),
    ],
    [appium, ['driver', 'install', 'xcuitest@12.22.8'], expect.any(AbortSignal)],
    [
      appium,
      [
        'driver',
        'run',
        'xcuitest',
        'download-wda',
        '--',
        '--outdir',
        wda,
        '--platform',
        'iOS',
        '--kind',
        'sim',
      ],
      expect.any(AbortSignal),
    ],
  ]);
  const npmCache = path.join(tmpdir, 'npm-cache');
  expect(seen).toEqual([
    ...Array(3).fill({ APPIUM_HOME: appiumHome, npm_config_cache: npmCache, prepared: false }),
  ]);
  expect(readPreparedManifest().tools.appium).toEqual({
    version: '3.9.0',
    xcuitest: '12.22.8',
    home: appiumHome,
  });
  expect(fs.existsSync(path.join(appiumHome, 'prepared.json'))).toBe(false);
  expect(fs.readFileSync(path.join(appiumHome, 'package.json'), 'utf8')).toBe(
    '{"name":"eas-appium-home","private":true}\n'
  );
});

test.each([
  ['only APPIUM_VERSION', { APPIUM_VERSION: '3.9.0' }],
  ['only XCUITEST_VERSION', { XCUITEST_VERSION: '12.22.8' }],
  ['APPIUM_VERSION=latest', { APPIUM_VERSION: 'latest', XCUITEST_VERSION: '12.22.8' }],
  ['XCUITEST_VERSION=^12', { APPIUM_VERSION: '3.9.0', XCUITEST_VERSION: '^12' }],
  ['APPIUM_VERSION=v3.9.0', { APPIUM_VERSION: 'v3.9.0', XCUITEST_VERSION: '12.22.8' }],
  [
    'XCUITEST_VERSION=12.22.8 || latest',
    { APPIUM_VERSION: '3.9.0', XCUITEST_VERSION: '12.22.8 || latest' },
  ],
])('prefetch rejects %s before any command', async (_name, pins) => {
  Object.assign(process.env, pins);
  await expect(mainAsync(['prefetch'])).rejects.toThrow(
    'Could not prefetch Appium: set all of APPIUM_VERSION, XCUITEST_VERSION to exact versions (x.y.z), or none of them.'
  );
  expect(commands.runOwnedAsync).not.toHaveBeenCalled();
});

test('prefetch removes the Appium home after a failed driver install', async () => {
  const { appiumHome, appium } = pinAppium();
  jest.mocked(commands.runOwnedAsync).mockImplementation(async (file, args) => {
    if (file === appium && args[1] === 'install') {
      throw Object.assign(new Error(`${appium} exited with 1.`), { code: 1 });
    }
    return '1.0.0\n';
  });
  await expect(mainAsync(['prefetch'])).rejects.toThrow(
    /Could not prefetch xcuitest@12\.22\.8: .*appium exited with 1\./
  );
  expect(fs.existsSync(appiumHome)).toBe(false);
});

test('prefetch removes the Appium home when download-wda leaves no runner', async () => {
  const { appiumHome } = pinAppium();
  await expect(mainAsync(['prefetch'])).rejects.toThrow(/Could not prefetch WebDriverAgent: /);
  expect(fs.existsSync(appiumHome)).toBe(false);
});

test('prefetch stores Expo Go and prepares Appium without Bun tool pins', async () => {
  for (const name of [
    'SERVE_SIM_VERSION',
    'AGENT_DEVICE_VERSION',
    'ARGENT_VERSION',
    'EXPO_SIMULATOR_PREINSTALL_EXPO_GO',
  ]) {
    delete process.env[name];
  }
  serveExpoGo();
  const { appiumHome, appium, wda } = pinAppium();
  jest.mocked(commands.runOwnedAsync).mockImplementation(async (file, args) => {
    if (file === '/usr/bin/tar') {
      fs.writeFileSync(path.join(args[3], 'Info.plist'), '<plist/>');
    }
    if (file === 'npm') {
      fs.mkdirSync(path.dirname(appium), { recursive: true });
      fs.writeFileSync(appium, '');
    }
    if (args.includes('download-wda')) {
      fs.mkdirSync(path.join(wda, 'WebDriverAgentRunner-Runner.app'), { recursive: true });
    }
    return '1.0.0\n';
  });
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(jest.mocked(commands.runOwnedAsync).mock.calls.map(([file]) => file)).not.toContain(
    'bunx'
  );
  expect(fs.readdirSync(cacheDirectory('expo-go'))).toHaveLength(1);
  expect(readPreparedManifest()).toEqual({
    tools: {
      appium: { version: '3.9.0', xcuitest: '12.22.8', home: appiumHome },
      'expo-go': { sdk: '58.0.0', url: expoGoUrl },
    },
  });
});

test('prefetch stores the Expo Go of EXPO_GO_SDK_VERSION, as start selects it', async () => {
  delete process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO;
  process.env.EXPO_GO_SDK_VERSION = '57.0.0';
  serveExpoGo();
  jest.mocked(commands.runOwnedAsync).mockImplementation(async (file, args) => {
    if (file === '/usr/bin/tar') {
      fs.writeFileSync(path.join(args[3], 'Info.plist'), '<plist/>');
    }
    return '1.0.0\n';
  });
  expect(await mainAsync(['prefetch'])).toBe(0);
  const hash = createHash('sha256').update(olderExpoGoUrl).digest('hex');
  expect(fs.readdirSync(cacheDirectory('expo-go'))).toEqual([`${hash}.tar.gz`]);
  expect(fetch).toHaveBeenLastCalledWith(olderExpoGoUrl, expect.anything());
  expect(process.stderr.write).toHaveBeenCalledWith(
    `Prefetched Expo Go (SDK 57.0.0 from ${olderExpoGoUrl}).\n`
  );
});

test.each(['latest', '58', '^58.0.0', 'v58.0.0'])(
  'prefetch ignores EXPO_GO_SDK_VERSION=%s when Expo Go is disabled',
  async pin => {
    process.env.EXPO_GO_SDK_VERSION = pin;
    expect(await mainAsync(['prefetch'])).toBe(0);
    expect(commands.runOwnedAsync).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  }
);

test.each(['latest', '58', '^58.0.0', 'v58.0.0'])(
  'prefetch rejects EXPO_GO_SDK_VERSION=%s before any command or download',
  async pin => {
    delete process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO;
    process.env.EXPO_GO_SDK_VERSION = pin;
    await expect(mainAsync(['prefetch'])).rejects.toThrow(
      'Could not prefetch Expo Go: set EXPO_GO_SDK_VERSION to an exact version (x.y.z), or leave it unset.'
    );
    expect(commands.runOwnedAsync).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  }
);

test.each([
  ['does not list', '62.0.0'],
  ['lists no Simulator archive for', '20.0.0'],
])('prefetch fails when the versions API %s EXPO_GO_SDK_VERSION', async (_, pin) => {
  delete process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO;
  process.env.EXPO_GO_SDK_VERSION = pin;
  serveExpoGo();
  await expect(mainAsync(['prefetch'])).rejects.toThrow(
    `Could not prefetch Expo Go: No Expo Go Simulator archive is available for SDK ${pin}.`
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(cacheDirectory('expo-go'))).toBe(false);
});
