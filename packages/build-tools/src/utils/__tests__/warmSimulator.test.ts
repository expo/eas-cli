import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';

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

it.each(['success', 'failure'] as const)(
  'logs only complete startup progress lines on %s, keeping stdout and other stderr private',
  async outcome => {
    jest.spyOn(fs, 'readFile').mockResolvedValue('{"launcherVersion":"27.4.0"}');
    const info = jest.fn();
    const logger = { info } as unknown as bunyan;
    const output = '{"server":{"token":"private-claim-token"}}';
    jest.mocked(spawn).mockImplementationOnce(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      queueMicrotask(() => {
        stdout.end(output);
        stderr.write('Warm Simulator is still');
        stderr.write(' starting; waiting (0s elapsed, 420s limit).\n');
        stderr.write('unrelated stderr with private-error-token\n');
        stderr.write('Warm Simulator became ready after waiting 12s.\n');
        stderr.end('Warm Simulator became ready after waiting 12s. private-suffix\n');
      });
      return Object.assign(
        outcome === 'success'
          ? Promise.resolve({ stdout: output })
          : Promise.reject(new Error('claim failed')),
        { child: { stdout, stderr } }
      ) as never;
    });
    const result = runSimulatorLauncherAsync(['claim', 'serve-sim'], { env: {}, logger });
    if (outcome === 'success') {
      await expect(result).resolves.toBe(output);
    } else {
      await expect(result).rejects.toThrow('claim failed');
    }
    expect(info.mock.calls).toEqual([
      ['Warm Simulator is still starting; waiting (0s elapsed, 420s limit).'],
      ['Warm Simulator became ready after waiting 12s.'],
    ]);
    expect(jest.mocked(spawn).mock.calls[0][2]).not.toHaveProperty('logger');
  }
);

it('reports startup progress before the launcher exits', async () => {
  jest.spyOn(fs, 'readFile').mockResolvedValue('{"launcherVersion":"27.4.0"}');
  const info = jest.fn();
  const logger = { info } as unknown as bunyan;
  const stderr = new PassThrough();
  let finish!: (result: { stdout: string }) => void;
  const completion = new Promise<{ stdout: string }>(resolve => {
    finish = resolve;
  });
  let started!: () => void;
  const spawning = new Promise<void>(resolve => {
    started = resolve;
  });
  jest.mocked(spawn).mockImplementationOnce(() => {
    started();
    return Object.assign(completion, { child: { stderr } }) as never;
  });
  let completed = false;
  const result = runSimulatorLauncherAsync(['claim', 'serve-sim'], { env: {}, logger }).then(
    output => {
      completed = true;
      return output;
    }
  );
  try {
    await spawning;
    stderr.write('Warm Simulator is still starting; waiting (0s elapsed, 420s limit).\n');
    expect(info).toHaveBeenCalledWith(
      'Warm Simulator is still starting; waiting (0s elapsed, 420s limit).'
    );
    expect(completed).toBe(false);
  } finally {
    stderr.end();
    finish({ stdout: '{"ok":true}' });
    await result;
  }
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
