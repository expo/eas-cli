import { type Job } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

import { maybeStopWarmSimulatorAsync } from '../warmSimulator';

jest.mock('@expo/turtle-spawn');

const originalPlatform = process.platform;
let savedEnvironment: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnvironment = { ...process.env };
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
