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

test('prefetch runs each pinned tool spec once, in order, without boot or stdout work', async () => {
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(jest.mocked(commands.runOwnedAsync).mock.calls).toEqual([
    ['bunx', ['@expo/serve-sim@0.13.3', '--version'], expect.any(AbortSignal)],
    ['bunx', ['agent-device@0.21.36', '--version'], expect.any(AbortSignal)],
    ['bunx', ['@swmansion/argent@0.32.0', '--version'], expect.any(AbortSignal)],
  ]);
  expect(commands.runOwnedAsync).not.toHaveBeenCalledWith('/usr/sbin/sysctl', expect.anything());
  expect(output).not.toHaveBeenCalled();
});

test('prefetch runs bunx in a throwaway TMPDIR and removes it', async () => {
  const tmpdirs: string[] = [];
  const existed: boolean[] = [];
  jest.mocked(commands.runOwnedAsync).mockImplementation(async () => {
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

test('prefetch caches no Bun tools when no versions are set', async () => {
  delete process.env.SERVE_SIM_VERSION;
  process.env.AGENT_DEVICE_VERSION = '';
  delete process.env.ARGENT_VERSION;
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(commands.runOwnedAsync).not.toHaveBeenCalled();
  expect(process.stderr.write).toHaveBeenCalledWith(
    'Skipping serve-sim, agent-device and Argent: SERVE_SIM_VERSION, AGENT_DEVICE_VERSION and ARGENT_VERSION are not set.\n'
  );
});

test.each([
  ['SERVE_SIM_VERSION', '@expo/serve-sim@0.13.3'],
  ['AGENT_DEVICE_VERSION', 'agent-device@0.21.36'],
  ['ARGENT_VERSION', '@swmansion/argent@0.32.0'],
])('prefetch prepares %s without the other tool pins', async (variable, spec) => {
  for (const other of ['SERVE_SIM_VERSION', 'AGENT_DEVICE_VERSION', 'ARGENT_VERSION']) {
    if (other !== variable) {
      delete process.env[other];
    }
  }
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(jest.mocked(commands.runOwnedAsync).mock.calls).toEqual([
    ['bunx', [spec, '--version'], expect.any(AbortSignal)],
  ]);
});

test.each([
  ['ARGENT_VERSION', 'latest'],
  ['AGENT_DEVICE_VERSION', '^0.21'],
  ['SERVE_SIM_VERSION', '^0.13.3'],
  ['ARGENT_VERSION', 'v0.32.0'],
  ['ARGENT_VERSION', '0.32.0 || latest'],
])('prefetch rejects %s=%s before any command', async (variable, value) => {
  process.env[variable] = value;
  await expect(mainAsync(['prefetch'])).rejects.toThrow(
    `set ${variable} to an exact version (x.y.z), or leave it unset.`
  );
  expect(commands.runOwnedAsync).not.toHaveBeenCalled();
});

test('prefetch stops at the first failed spec and removes its TMPDIR', async () => {
  let tmpdir = '';
  jest
    .mocked(commands.runOwnedAsync)
    .mockImplementationOnce(async () => {
      tmpdir = process.env.TMPDIR ?? '';
      return '0.13.3\n';
    })
    .mockRejectedValueOnce(Object.assign(new Error('bunx exited with 1.'), { code: 1 }));
  await expect(mainAsync(['prefetch'])).rejects.toThrow(
    /Could not prefetch agent-device@0\.21\.36: bunx exited with 1\./
  );
  expect(commands.runOwnedAsync).toHaveBeenCalledTimes(2);
  expect(tmpdir).toMatch(/simulator-launcher-prefetch-/);
  expect(fs.existsSync(tmpdir)).toBe(false);
});

test('prefetch reports a timed-out spec', async () => {
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
  jest
    .mocked(commands.runOwnedAsync)
    .mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    );
  await expect(mainAsync(['prefetch'])).rejects.toThrow(
    /Could not prefetch @expo\/serve-sim@0\.13\.3 within 300 seconds\./
  );
  expect(commands.runOwnedAsync).toHaveBeenCalledTimes(1);
});

test.each(['SIGINT', 'SIGTERM'] as const)(
  'standalone prefetch drains before failing on %s',
  async event => {
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
      message: 'Could not prefetch @expo/serve-sim@0.13.3: Simulator prefetch was interrupted.',
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

test('prefetch skips disabled Expo Go and removes older files', async () => {
  for (const name of ['expo-go']) {
    fs.mkdirSync(cacheDirectory(name), { recursive: true });
    fs.writeFileSync(path.join(cacheDirectory(name), 'old'), 'old');
  }
  expect(await mainAsync(['prefetch'])).toBe(0);
  expect(process.stderr.write).toHaveBeenCalledWith(
    'Skipping Expo Go: EXPO_SIMULATOR_PREINSTALL_EXPO_GO=0.\n'
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(fs.readdirSync(path.dirname(cacheDirectory('expo-go')))).toEqual([]);
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
  expect(jest.mocked(commands.runOwnedAsync).mock.calls.slice(3)).toEqual([
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
    expect(jest.mocked(commands.runOwnedAsync).mock.calls).toEqual([
      ['bunx', ['@expo/serve-sim@0.13.3', '--version'], expect.any(AbortSignal)],
      ['bunx', ['agent-device@0.21.36', '--version'], expect.any(AbortSignal)],
      ['bunx', ['@swmansion/argent@0.32.0', '--version'], expect.any(AbortSignal)],
    ]);
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
