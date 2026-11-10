import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

import {
  readPreparedSimulatorToolAsync,
  runSimulatorLauncherAsync,
  stopWarmSimulatorAsync,
} from '../warmSimulator';

jest.mock('@expo/turtle-spawn');
jest.mock('node:timers/promises');

const originalPlatform = process.platform;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  jest.resetAllMocks();
  jest.mocked(spawn).mockResolvedValue({ stdout: '{"ok":true}' } as never);
  jest.spyOn(os, 'uptime').mockReturnValue(600);
  jest.spyOn(fs, 'access').mockRejectedValue(new Error('no startup script'));
  jest.mocked(sleepAsync).mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

it('reads different prepared tool schemas without Appium-specific fields', async () => {
  const directory = path.join(os.homedir(), 'Library', 'Caches', 'expo-simulator-startup');
  const appium = { home: path.join(directory, 'appium'), version: '3.9.0', xcuitest: '12.22.8' };
  const otherTool = { version: '2.4.0' };
  const expoGo = { sdk: '55.0.0', url: 'https://example.test/ExpoGo.tar.gz' };
  const read = jest
    .spyOn(fs, 'readFile')
    .mockResolvedValue(
      JSON.stringify({ tools: { appium, 'other-tool': otherTool, 'expo-go': expoGo } })
    );

  await expect(
    readPreparedSimulatorToolAsync(
      'appium',
      z.object({ home: z.string(), version: z.string(), xcuitest: z.string() })
    )
  ).resolves.toEqual(appium);
  const prepared = await readPreparedSimulatorToolAsync(
    'other-tool',
    z.object({ version: z.string() })
  );
  expect(prepared?.version).toBe('2.4.0');
  await expect(
    readPreparedSimulatorToolAsync('expo-go', z.object({ sdk: z.string(), url: z.string() }))
  ).resolves.toEqual(expoGo);
  expect(read.mock.calls).toEqual([
    [path.join(directory, 'prepared.json'), 'utf8'],
    [path.join(directory, 'prepared.json'), 'utf8'],
    [path.join(directory, 'prepared.json'), 'utf8'],
  ]);
  expect(spawn).not.toHaveBeenCalled();
});

it.each(['missing-tool', 'toString'])(
  'does not invent %s metadata from schema defaults or inherited properties',
  async tool => {
    jest.spyOn(fs, 'readFile').mockResolvedValue('{"tools":{}}');
    await expect(
      readPreparedSimulatorToolAsync(tool, z.unknown().default({ version: '1.2.3' }))
    ).resolves.toBeUndefined();
  }
);

it.each(['missing', 'invalid JSON', 'invalid fields', 'missing tool', 'older format'])(
  'ignores prepared tool metadata with %s',
  async failure => {
    const read = jest.spyOn(fs, 'readFile');
    switch (failure) {
      case 'missing':
        read.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        break;
      case 'invalid JSON':
        read.mockResolvedValue('not JSON');
        break;
      case 'invalid fields':
        read.mockResolvedValue(JSON.stringify({ tools: { tool: { version: 42 } } }));
        break;
      case 'missing tool':
        read.mockResolvedValue('{"tools":{}}');
        break;
      case 'older format':
        read.mockResolvedValue('{"appium":"3.9.0","xcuitest":"12.22.8","home":"/old/home"}');
        break;
    }
    await expect(
      readPreparedSimulatorToolAsync('tool', z.object({ version: z.string() }))
    ).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  }
);

it('runs the launcher version that start recorded and returns its output', async () => {
  jest.spyOn(fs, 'readFile').mockResolvedValue('{"launcherVersion":"27.1.0"}');
  await expect(runSimulatorLauncherAsync(['claim', 'serve-sim'], { env: {} })).resolves.toBe(
    '{"ok":true}'
  );
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '@expo/simulator-launcher@27.1.0', 'claim', 'serve-sim'],
    expect.objectContaining({ stdio: 'pipe' })
  );
  expect(jest.mocked(spawn).mock.calls[0][2]).not.toHaveProperty('logger');
});

it.each([
  [{}, 'bun', ['x']],
  [{ EAS_OVERRIDE_PACKAGE_MANAGER: 'npm' }, 'npx', ['--yes']],
])(
  'stops with the latest launcher and the configured package manager for %j',
  async (env, command, prefix) => {
    jest
      .spyOn(fs, 'readFile')
      .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await stopWarmSimulatorAsync(env);
    expect(spawn).toHaveBeenCalledWith(
      command,
      [...prefix, '@expo/simulator-launcher@latest', 'stop'],
      expect.objectContaining({ env })
    );
  }
);

it('rejects when the launcher cannot confirm cleanup', async () => {
  jest.spyOn(fs, 'readFile').mockResolvedValue('{}');
  jest.mocked(spawn).mockRejectedValue(new Error('cleanup failed'));
  await expect(stopWarmSimulatorAsync({})).rejects.toThrow('cleanup failed');
});

it('does nothing on other platforms', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  await stopWarmSimulatorAsync({});
  expect(spawn).not.toHaveBeenCalled();
});

const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
const warmEnv = { EAS_USE_WARM_SIMULATOR: '1', EAS_OVERRIDE_PACKAGE_MANAGER: 'bun' };

it('waits for startup to write state, then claims with the recorded launcher version', async () => {
  jest.mocked(os.uptime).mockReturnValue(10);
  jest.mocked(fs.access).mockResolvedValue();
  jest
    .spyOn(fs, 'readFile')
    .mockRejectedValueOnce(missing)
    .mockRejectedValueOnce(missing)
    .mockResolvedValue('{"launcherVersion":"27.6.0"}');
  await runSimulatorLauncherAsync(['claim', 'serve-sim'], { env: warmEnv });
  expect(sleepAsync).toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '@expo/simulator-launcher@27.6.0', 'claim', 'serve-sim'],
    expect.objectContaining({ env: warmEnv })
  );
});

it.each([
  ['a later session request', ['claim', 'serve-sim'], warmEnv, 300, true],
  ['a system without startup', ['claim', 'serve-sim'], warmEnv, 10, false],
  ['a job without warmup', ['claim', 'serve-sim'], {}, 10, true],
  ['stop', ['stop'], warmEnv, 10, true],
  ['prepare-tools', ['prepare-tools'], warmEnv, 10, true],
])('does not wait for %s', async (_name, args, env, uptime, installed) => {
  jest.mocked(os.uptime).mockReturnValue(uptime);
  if (installed) {
    jest.mocked(fs.access).mockResolvedValue();
  }
  jest.spyOn(fs, 'readFile').mockRejectedValue(missing);
  await runSimulatorLauncherAsync(args, { env });
  expect(sleepAsync).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalled();
});

it('times out before invoking claim so its caller can stop warmup before starting cold', async () => {
  jest.mocked(os.uptime).mockReturnValue(10);
  jest.mocked(fs.access).mockResolvedValue();
  jest.spyOn(fs, 'readFile').mockRejectedValue(missing);
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.mocked(sleepAsync).mockImplementation(async delay => {
    now += delay ?? 0;
  });
  await expect(runSimulatorLauncherAsync(['claim', 'serve-sim'], { env: warmEnv })).rejects.toThrow(
    'Timed out waiting for the warm Simulator launcher to start.'
  );
  expect(now).toBe(60_000);
  expect(spawn).not.toHaveBeenCalled();
  await stopWarmSimulatorAsync(warmEnv);
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '@expo/simulator-launcher@latest', 'stop'],
    expect.anything()
  );
});

it('cancels the missing-state wait without invoking claim', async () => {
  jest.mocked(os.uptime).mockReturnValue(10);
  jest.mocked(fs.access).mockResolvedValue();
  jest.spyOn(fs, 'readFile').mockRejectedValue(missing);
  const controller = new AbortController();
  jest.mocked(sleepAsync).mockImplementation(async () => {
    controller.abort(new Error('cancelled'));
  });
  await expect(
    runSimulatorLauncherAsync(['claim', 'serve-sim'], {
      env: warmEnv,
      signal: controller.signal,
    })
  ).rejects.toThrow('cancelled');
  expect(spawn).not.toHaveBeenCalled();
});
