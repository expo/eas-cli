import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

import { createColdIosSessionAsync } from '../coldIosSession';
import { spawnDetached } from '../remoteDeviceRunSession';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { readLocalEgressHandoffAsync } from '../localEgress';
import { runSimulatorLauncherAsync, stopWarmSimulatorAsync } from '../../../utils/warmSimulator';
import { WarmSessionAdoptionError, runOnWarmIosSimulatorAsync } from '../warmDeviceSessionHost';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/IosSimulatorUtils');
jest.mock('../../../utils/warmSimulator');
jest.mock('../localEgress', () => ({
  readLocalEgressHandoffAsync: jest.fn(),
}));
jest.mock('../remoteDeviceRunSession', () => ({
  fetchWebPreviewTurnArgsAsync: jest.fn(async () => []),
  findAvailablePortAsync: jest.fn(async () => 3200),
  spawnDetached: jest.fn(() => ({ stopAsync: jest.fn() })),
}));

const STATE_FILE = '/tmp/expo-simulator-startup.json';
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const logger = { info: jest.fn(), warn: jest.fn() } as any;

const UDID = '00000000-0000-4000-8000-000000000001';

async function startServerAsync(signal?: AbortSignal, env: NodeJS.ProcessEnv = {}) {
  const server = await createColdIosSessionAsync({} as any, {
    env,
    logger,
    iosSimulatorUdid: UDID,
  });
  return await server.startAsync({
    command: 'serve-sim',
    args: [UDID, '--require-token'],
    env,
    logger,
    secrets: [],
    stopGracePeriodMs: 1000,
    signal,
  });
}

beforeEach(async () => {
  jest.mocked(stopWarmSimulatorAsync).mockResolvedValue(undefined);
  jest.mocked(runSimulatorLauncherAsync).mockResolvedValue(
    JSON.stringify({
      serveSimVersion: '0.20.0',
      agentDeviceVersion: '1.0.0',
      device: { udid: UDID, name: 'iPhone 17' },
      server: { pid: 10, port: 3200, token: 'test-token' },
      agentDeviceStateDir: '/agent',
      argentEventLogPath: '/argent/events',
    })
  );
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue(null);
  jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Shutdown' } as never);
  jest.mocked(spawn).mockResolvedValue({ stdout: 'current-boot\n' } as never);
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  await fs.mkdir('/tmp', { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify({ status: 'stopping' }));
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
});

it('starts serve-sim only after warm Simulator cleanup finished', async () => {
  const starting = startServerAsync();
  await new Promise(resolve => setTimeout(resolve, 600));
  expect(spawnDetached).not.toHaveBeenCalled();
  expect(IosSimulatorUtils.getDeviceAsync).not.toHaveBeenCalled();
  await fs.writeFile(STATE_FILE, JSON.stringify({ status: 'disabled', bootUuid: 'current-boot' }));
  await starting;
  expect(spawnDetached).toHaveBeenCalledTimes(1);
});

it('does not start serve-sim when the job is cancelled while cleanup runs', async () => {
  const controller = new AbortController();
  const starting = startServerAsync(controller.signal);
  // Cleanup is still running; the cancellation alone must end the wait.
  controller.abort(new Error('cancelled'));
  await expect(starting).rejects.toThrow('cancelled');
  expect(spawnDetached).not.toHaveBeenCalled();
});

it.each([false, true])('selects an explicit cold policy (local egress: %s)', async local => {
  if (local) {
    jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue({ port: 8899 } as never);
  }
  await startServerAsync(undefined, { EAS_USE_WARM_SIMULATOR: '1' });
  expect(spawnDetached).toHaveBeenCalledWith(
    expect.objectContaining({
      args: [UDID, '--require-token', local ? '--enable' : '--disable', 'egressGuard'],
      env: { EAS_USE_WARM_SIMULATOR: '1' },
    })
  );
  expect(spawn).not.toHaveBeenCalled();
});

it('shuts down the selected running device before resident cold startup', async () => {
  jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Booted' } as never);
  await startServerAsync(undefined, { EAS_USE_WARM_SIMULATOR: '1' });
  expect(spawn).toHaveBeenCalledWith('xcrun', ['simctl', 'shutdown', UDID], expect.anything());
  expect(jest.mocked(spawn).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(spawnDetached).mock.invocationCallOrder[0]!
  );
});

it('does not launch after an unconfirmed shutdown', async () => {
  const failure = new Error('Shutdown failed');
  jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Booted' } as never);
  jest.mocked(spawn).mockRejectedValueOnce(failure);
  await expect(startServerAsync(undefined, { EAS_USE_WARM_SIMULATOR: '1' })).rejects.toBe(failure);
  expect(spawnDetached).not.toHaveBeenCalled();
});

it('preserves cancellation while shutting down', async () => {
  const controller = new AbortController();
  const stopped = new Error('Job stopped');
  jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Booted' } as never);
  jest.mocked(spawn).mockImplementationOnce(() => {
    controller.abort(stopped);
    return Promise.reject(new Error('Spawn aborted')) as ReturnType<typeof spawn>;
  });
  await expect(startServerAsync(controller.signal, { EAS_USE_WARM_SIMULATOR: '1' })).rejects.toBe(
    stopped
  );
  expect(spawnDetached).not.toHaveBeenCalled();
});

it.each(['version mismatch', 'adoption failure'])(
  'retries the same warmed device with an explicit cold policy after %s',
  async failure => {
    const env = { EAS_USE_WARM_SIMULATOR: '1' };
    await runOnWarmIosSimulatorAsync(
      {
        engine: 'agent-device',
        requestedDevice: UDID,
        packageVersion: failure === 'version mismatch' ? '2.0.0' : undefined,
        env,
        logger,
      },
      async warm => {
        if (warm) {
          throw new WarmSessionAdoptionError();
        }
        expect(stopWarmSimulatorAsync).toHaveBeenCalledTimes(1);
        return startServerAsync(undefined, env);
      }
    );
    expect(spawnDetached).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [UDID, '--require-token', '--disable', 'egressGuard'],
      })
    );
  }
);
