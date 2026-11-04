import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

import { runSimulatorLauncherAsync, stopWarmSimulatorAsync } from '../warmSimulator';

jest.mock('@expo/turtle-spawn');

const originalPlatform = process.platform;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  jest.resetAllMocks();
  jest.mocked(spawn).mockResolvedValue({ stdout: '{"ok":true}' } as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

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
