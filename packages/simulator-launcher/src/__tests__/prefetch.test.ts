import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { mainAsync } from '../main';
import { commands } from '../utils/processes';
import { deferred, until } from './helpers';

jest.mock('../utils/processes');

const platform = process.platform;
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

test('prefetch rejects extra arguments before any native work', async () => {
  await expect(mainAsync(['prefetch', 'x'])).rejects.toThrow(/Usage: .*\|prefetch>/);
  expect(commands.runOwnedAsync).not.toHaveBeenCalled();
});
