import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { stopWarmSimulatorAsync } from '../warmSimulator';

jest.mock('@expo/turtle-spawn');

const originalPlatform = process.platform;

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  jest.resetAllMocks();
  jest.mocked(spawn).mockResolvedValue({ stdout: '' } as Awaited<ReturnType<typeof spawn>>);
});
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

it('does nothing on non-Darwin workers', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  await stopWarmSimulatorAsync();
  expect(spawn).not.toHaveBeenCalled();
});

it.each([
  [{}, 'bun', ['x']],
  [{ EAS_FALLBACK_PACKAGE_MANAGER: 'npm' }, 'npx', ['--yes']],
  [{ EAS_OVERRIDE_PACKAGE_MANAGER: 'pnpm' }, 'pnpm', ['dlx']],
  [{ EAS_OVERRIDE_PACKAGE_MANAGER: 'yarn' }, 'npx', ['--yes']],
  [{ EAS_OVERRIDE_PACKAGE_MANAGER: 'npm', EAS_FALLBACK_PACKAGE_MANAGER: 'bun' }, 'npx', ['--yes']],
])('uses the configured package manager for %j', async (env, command, prefix) => {
  const logger = {} as bunyan;
  await stopWarmSimulatorAsync(logger, env);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledWith(
    command,
    [...prefix, '@expo/simulator-launcher@latest', 'stop'],
    { env, logger, stdio: 'pipe', timeout: 150_000 }
  );
});

it('awaits the CLI stop result before allowing job setup', async () => {
  let finish!: () => void;
  const stopped = new Promise<Awaited<ReturnType<typeof spawn>>>(resolve => {
    finish = () => resolve({ stdout: '' } as Awaited<ReturnType<typeof spawn>>);
  });
  jest.mocked(spawn).mockReturnValue(stopped as ReturnType<typeof spawn>);
  let complete = false;
  const stopping = stopWarmSimulatorAsync(undefined, {}).then(() => {
    complete = true;
  });
  try {
    await Promise.resolve();
    expect(complete).toBe(false);
    finish();
    await stopping;
    expect(complete).toBe(true);
  } finally {
    finish();
    await stopping;
  }
});

it('propagates download or teardown failures instead of permitting setup', async () => {
  const error = new Error('launcher stop failed');
  jest.mocked(spawn).mockRejectedValue(error);
  await expect(stopWarmSimulatorAsync(undefined, {})).rejects.toBe(error);
});

it('rejects an invalid package manager preference', async () => {
  await expect(
    stopWarmSimulatorAsync(undefined, {
      EAS_OVERRIDE_PACKAGE_MANAGER: 'invalid',
    })
  ).rejects.toThrow('Invalid EAS_OVERRIDE_PACKAGE_MANAGER');
  expect(spawn).not.toHaveBeenCalled();
});
