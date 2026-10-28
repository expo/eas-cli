import { type Job } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

import { maybeStopWarmSimulatorAsync } from '../warmSimulator';

jest.mock('@expo/turtle-spawn');
jest.mock('node:fs/promises', () => ({ access: jest.fn(), readFile: jest.fn() }));

const baseJob = {} as Job;
const originalPlatform = process.platform;
const startup = '/usr/local/share/vm-tools/startup.sh';
const state = '/tmp/expo-simulator-startup.json';
let environment: NodeJS.ProcessEnv;
beforeEach(() => {
  environment = { ...process.env };
  delete process.env.EAS_OVERRIDE_PACKAGE_MANAGER;
  delete process.env.EAS_FALLBACK_PACKAGE_MANAGER;
  jest.mocked(fs.access).mockReset().mockResolvedValue();
  jest
    .mocked(fs.readFile)
    .mockReset()
    .mockResolvedValue(
      JSON.stringify({
        bootUuid: 'current-boot',
        status: 'disabled',
        launcherVersion: '25.3.0',
      })
    );
  jest
    .mocked(spawn)
    .mockReset()
    .mockResolvedValue({ stdout: '' } as Awaited<ReturnType<typeof spawn>>);
  Object.defineProperty(process, 'platform', { value: 'darwin' });
});
afterEach(() => {
  process.env = environment;
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

it('delegates state and boot handling to one launcher stop command', async () => {
  await maybeStopWarmSimulatorAsync({} as Job);
  expect(fs.readFile).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledWith('bun', ['x', '@expo/simulator-launcher@latest', 'stop'], {
    env: expect.objectContaining({ PATH: process.env.PATH }),
    stdio: 'pipe',
    timeout: 150_000,
  });
});

it('waits for the launcher to confirm cleanup', async () => {
  let finish!: (value: Awaited<ReturnType<typeof spawn>>) => void;
  jest.mocked(spawn).mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }) as ReturnType<typeof spawn>
  );
  let finished = false;
  const stopping = maybeStopWarmSimulatorAsync({} as Job).then(() => {
    finished = true;
  });
  for (let turn = 0; turn < 20 && !finish; turn++) {
    await Promise.resolve();
  }
  expect(finish).toBeDefined();
  expect(finished).toBe(false);
  finish({ stdout: '' } as Awaited<ReturnType<typeof spawn>>);
  await stopping;
  expect(finished).toBe(true);
});

it.each(['cleanup failed', "Could not find an existing 'simulator-launcher' binary --no-install"])(
  'propagates stop failure without retrying: %s',
  async stderr => {
    const error = Object.assign(new Error(stderr), { status: 1, stdout: '', stderr });
    jest.mocked(spawn).mockRejectedValueOnce(error);
    await expect(maybeStopWarmSimulatorAsync({} as Job)).rejects.toBe(error);
    expect(spawn).toHaveBeenCalledTimes(1);
  }
);

it('does nothing on non-Darwin', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  await maybeStopWarmSimulatorAsync({} as Job);
  expect(fs.access).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});
it('keeps warmup only for the job opt-in, independently of the host flag', async () => {
  await maybeStopWarmSimulatorAsync({
    ...baseJob,
    builderEnvironment: { image: 'test-image', env: { EAS_USE_WARM_SIMULATOR: '1' } },
  });
  expect(fs.access).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  process.env.EAS_USE_WARM_SIMULATOR = '1';
  await maybeStopWarmSimulatorAsync({} as Job);
  expect(spawn).toHaveBeenCalledTimes(1);
});
it.each([startup, state])('stops when the image has only %s', async present => {
  jest.mocked(fs.access).mockImplementation(async file => {
    if (file !== present) {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }
  });
  await maybeStopWarmSimulatorAsync({} as Job);
  expect(spawn).toHaveBeenCalledTimes(1);
});
it('makes no package-manager call on an image with neither warmup file', async () => {
  jest.mocked(fs.access).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  await maybeStopWarmSimulatorAsync({} as Job);
  expect(spawn).not.toHaveBeenCalled();
});
it.each([startup, state])('fails closed if checking %s fails', async inaccessible => {
  const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  jest.mocked(fs.access).mockImplementation(async file => {
    if (file === inaccessible) {
      throw error;
    }
  });
  await expect(maybeStopWarmSimulatorAsync({} as Job)).rejects.toBe(error);
  expect(spawn).not.toHaveBeenCalled();
});
it('preserves the job package-manager override and environment', async () => {
  process.env.EAS_OVERRIDE_PACKAGE_MANAGER = 'bun';
  await maybeStopWarmSimulatorAsync({
    ...baseJob,
    builderEnvironment: { image: 'test-image', env: { EAS_OVERRIDE_PACKAGE_MANAGER: 'npm' } },
  });
  expect(spawn).toHaveBeenCalledWith('npx', ['--yes', '@expo/simulator-launcher@latest', 'stop'], {
    env: expect.objectContaining({ EAS_OVERRIDE_PACKAGE_MANAGER: 'npm', PATH: process.env.PATH }),
    stdio: 'pipe',
    timeout: 150_000,
  });
});
