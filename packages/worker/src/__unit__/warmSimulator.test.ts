import { type Job } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

import { maybeStopWarmSimulatorAsync } from '../warmSimulator';

jest.mock('@expo/turtle-spawn');
jest.mock('node:fs/promises', () => ({ access: jest.fn(), readFile: jest.fn() }));

const originalPlatform = process.platform;
let savedEnvironment: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnvironment = { ...process.env };
  jest.mocked(fs.access).mockReset().mockResolvedValue(undefined);
  jest
    .mocked(fs.readFile)
    .mockReset()
    .mockRejectedValue(Object.assign(new Error('no state'), { code: 'ENOENT' }));
  delete process.env.EAS_OVERRIDE_PACKAGE_MANAGER;
  delete process.env.EAS_FALLBACK_PACKAGE_MANAGER;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  jest
    .mocked(spawn)
    .mockReset()
    .mockResolvedValue({ stdout: '' } as Awaited<ReturnType<typeof spawn>>);
});
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  process.env = savedEnvironment;
});

it('retains preparation for the exact job opt-in', async () => {
  await maybeStopWarmSimulatorAsync({
    builderEnvironment: { env: { EAS_USE_WARM_SIMULATOR: '1' } },
  } as unknown as Job);
  expect(spawn).not.toHaveBeenCalled();
});

it.each([
  ['missing builder environment', {}],
  ['missing environment', { builderEnvironment: {} }],
  ['missing flag', { builderEnvironment: { env: {} } }],
  ['disabled flag', { builderEnvironment: { env: { EAS_USE_WARM_SIMULATOR: '0' } } }],
  ['non-1 flag', { builderEnvironment: { env: { EAS_USE_WARM_SIMULATOR: 'true' } } }],
])('directly awaits launcher stop for a %s', async (_, job) => {
  await maybeStopWarmSimulatorAsync(job as Job);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledWith('bun', ['x', '@expo/simulator-launcher@latest', 'stop'], {
    env: expect.objectContaining({ PATH: process.env.PATH }),
    stdio: 'pipe',
    timeout: 150_000,
  });
});

it('uses the job package manager preference over the host preference', async () => {
  process.env.EAS_OVERRIDE_PACKAGE_MANAGER = 'npm';
  await maybeStopWarmSimulatorAsync({
    builderEnvironment: { env: { EAS_OVERRIDE_PACKAGE_MANAGER: 'bun' } },
  } as unknown as Job);
  expect(spawn).toHaveBeenCalledWith('bun', ['x', '@expo/simulator-launcher@latest', 'stop'], {
    env: expect.objectContaining({ EAS_OVERRIDE_PACKAGE_MANAGER: 'bun', PATH: process.env.PATH }),
    stdio: 'pipe',
    timeout: 150_000,
  });
});

it('honors a job package manager fallback', async () => {
  await maybeStopWarmSimulatorAsync({
    builderEnvironment: { env: { EAS_FALLBACK_PACKAGE_MANAGER: 'npm' } },
  } as unknown as Job);
  expect(spawn).toHaveBeenCalledWith(
    'npx',
    ['--yes', '@expo/simulator-launcher@latest', 'stop'],
    expect.anything()
  );
});

it('uses the job opt-in instead of the host flag', async () => {
  process.env.EAS_USE_WARM_SIMULATOR = '1';
  await maybeStopWarmSimulatorAsync({ builderEnvironment: { env: {} } } as Job);
  expect(spawn).toHaveBeenCalledTimes(1);
  process.env.EAS_USE_WARM_SIMULATOR = '0';
  jest.mocked(spawn).mockClear();
  await maybeStopWarmSimulatorAsync({
    builderEnvironment: { env: { EAS_USE_WARM_SIMULATOR: '1' } },
  } as unknown as Job);
  expect(spawn).not.toHaveBeenCalled();
});

it('does nothing on non-Darwin', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  await maybeStopWarmSimulatorAsync({} as Job);
  expect(spawn).not.toHaveBeenCalled();
});

it('propagates command failure instead of allowing job setup', async () => {
  const error = new Error('Stop acknowledgement timed out');
  jest.mocked(spawn).mockRejectedValueOnce(error);
  await expect(maybeStopWarmSimulatorAsync({} as Job)).rejects.toBe(error);
});

it('does not resolve a package on images without the startup script', async () => {
  jest
    .mocked(fs.access)
    .mockRejectedValue(Object.assign(new Error('missing script'), { code: 'ENOENT' }));
  await maybeStopWarmSimulatorAsync({} as Job);
  expect(fs.readFile).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});
it.each(['EACCES', 'EIO'])('fails closed on a startup script %s error', async code => {
  const error = Object.assign(new Error(code), { code });
  jest.mocked(fs.access).mockRejectedValue(error);
  await expect(maybeStopWarmSimulatorAsync({} as Job)).rejects.toBe(error);
  expect(spawn).not.toHaveBeenCalled();
});
it('uses Bun and the recorded version when warmup has started', async () => {
  jest.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ launcherVersion: '25.3.0' }));
  await maybeStopWarmSimulatorAsync({
    builderEnvironment: { env: { EAS_OVERRIDE_PACKAGE_MANAGER: 'npm' } },
  } as unknown as Job);
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '--no-install', '@expo/simulator-launcher@25.3.0', 'stop'],
    expect.anything()
  );
});

it('retries once without --no-install only when Bun cannot resolve the cached binary', async () => {
  jest.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ launcherVersion: '25.3.0' }));
  const failure = Object.assign(new Error('Bun resolution failed'), {
    status: 1,
    stdout: '',
    stderr:
      "error: Could not find an existing 'simulator-launcher' binary to run. Stopping because --no-install was passed.",
  });
  jest.mocked(spawn).mockRejectedValueOnce(failure);
  await maybeStopWarmSimulatorAsync({} as Job);
  expect(jest.mocked(spawn).mock.calls.map(([file, args]) => [file, args])).toEqual([
    ['bun', ['x', '--no-install', '@expo/simulator-launcher@25.3.0', 'stop']],
    ['bun', ['x', '@expo/simulator-launcher@25.3.0', 'stop']],
  ]);
});
it.each(['cleanup failed', 'error: failed to install package'])(
  'does not retry a launcher or other Bun failure: %s',
  async stderr => {
    jest.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ launcherVersion: '25.3.0' }));
    const failure = Object.assign(new Error(stderr), { status: 1, stdout: '', stderr });
    jest.mocked(spawn).mockRejectedValueOnce(failure);
    await expect(maybeStopWarmSimulatorAsync({} as Job)).rejects.toBe(failure);
    expect(spawn).toHaveBeenCalledTimes(1);
  }
);
it('propagates failure of the single cache-resolution retry', async () => {
  jest.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ launcherVersion: '25.3.0' }));
  const missing = Object.assign(new Error('Bun resolution failed'), {
    status: 1,
    stdout: '',
    stderr:
      "error: Could not find an existing 'simulator-launcher' binary to run. Stopping because --no-install was passed.",
  });
  const failure = new Error('retry failed');
  jest.mocked(spawn).mockRejectedValueOnce(missing).mockRejectedValueOnce(failure);
  await expect(maybeStopWarmSimulatorAsync({} as Job)).rejects.toBe(failure);
  expect(spawn).toHaveBeenCalledTimes(2);
});
