import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { type CustomBuildContext } from '../../../customBuildContext';
import { IosSimulatorRecordingUtils } from '../IosSimulatorRecordingUtils';
import { fetchWebPreviewTurnArgsAsync } from '../remoteDeviceRunSession';
import {
  WarmSessionAdoptionError,
  createWarmDeviceSessionServer,
  runOnWarmIosSimulatorAsync,
} from '../warmDeviceSessionHost';
import { type WarmIosSession, tryClaimWarmIosSessionAsync } from '../warmIosSession';

jest.mock('@expo/turtle-spawn');
jest.mock('../IosSimulatorRecordingUtils');
jest.mock('../warmIosSession');
jest.mock('../remoteDeviceRunSession', () => ({
  ...jest.requireActual('../remoteDeviceRunSession'),
  fetchWebPreviewTurnArgsAsync: jest.fn(),
}));

const ctx = {} as CustomBuildContext;
const logger = { warn: jest.fn() } as unknown as bunyan;
let warm: WarmIosSession;

function launch(signal?: AbortSignal) {
  return {
    command: 'bunx',
    args: ['serve-sim', '--port', '3200'],
    env: {},
    logger,
    signal,
    secrets: [],
    stopGracePeriodMs: 1_000,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockResolvedValue(['--turn', 'creds']);
  jest.mocked(spawn).mockResolvedValue({ stdout: '' } as never);
  jest
    .mocked(IosSimulatorRecordingUtils.prepareAdoptedRecordingAsync)
    .mockResolvedValue({ output: '/recordings/id', recordingId: 'id' });
  warm = {
    device: { udid: 'UDID', name: 'iPhone 17' },
    server: { pid: 10, port: 3200, token: 'serve-token' },
    agentDeviceStateDir: '/agent',
    argentEventLogPath: '/argent/events',
    preinstalledExpoGo: {
      bundleIdentifier: 'host.exp.Exponent',
      shortVersion: '2.0',
      version: '1',
    },
    prepareToolsAsync: jest.fn().mockResolvedValue(undefined),
    process: {
      pid: 10,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: jest.fn().mockResolvedValue(undefined),
    },
  };
});

it('adopts the warm device on the warm port with its recording, then prepares tools', async () => {
  const server = createWarmDeviceSessionServer(ctx, logger, warm);
  expect(server).toMatchObject({
    port: 3200,
    requiresPreviewRetirement: true,
    preinstalledApp: warm.preinstalledExpoGo,
  });
  const handle = await server.startAsync(launch());
  expect(spawn).toHaveBeenCalledWith(
    'bunx',
    [
      'serve-sim',
      '--port',
      '3200',
      '--single-device',
      'UDID',
      '--adopt',
      '--recording-output',
      '/recordings/id',
      '--recording-id',
      'id',
    ],
    expect.objectContaining({ stdio: 'pipe' })
  );
  expect(warm.prepareToolsAsync).toHaveBeenCalled();
  expect(handle.pid).toBe(10);
  await handle.stopAsync();
  expect(warm.process.stopAsync).toHaveBeenCalledTimes(1);
});

it.each([
  ['adoption', () => jest.mocked(spawn).mockRejectedValue(new Error('adopt --turn creds failed'))],
  [
    'tool preparation',
    () => jest.mocked(warm.prepareToolsAsync).mockRejectedValue(new Error('no tool')),
  ],
])('reports a %s failure as an adoption error without its details', async (_name, setup) => {
  setup();
  const error = await createWarmDeviceSessionServer(ctx, logger, warm)
    .startAsync(launch())
    .catch(error => error);
  expect(error).toBeInstanceOf(WarmSessionAdoptionError);
  expect(String(error)).not.toContain('creds');
});

it('reports a cancellation as a cancellation', async () => {
  const controller = new AbortController();
  jest.mocked(spawn).mockImplementation((() => {
    controller.abort(new Error('cancelled'));
    return Promise.reject(new Error('killed'));
  }) as never);
  await expect(
    createWarmDeviceSessionServer(ctx, logger, warm).startAsync(launch(controller.signal))
  ).rejects.toThrow('cancelled');
});

describe(runOnWarmIosSimulatorAsync, () => {
  const claim = { engine: 'serve-sim' as const, env: {}, logger };

  it('runs cold when there is no warm Simulator to claim', async () => {
    jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(undefined);
    const run = jest.fn().mockResolvedValue('cold');
    await expect(runOnWarmIosSimulatorAsync(claim, run)).resolves.toBe('cold');
    expect(run).toHaveBeenCalledWith(undefined);
  });

  it('runs on the claimed warm Simulator', async () => {
    jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(warm);
    const run = jest.fn().mockResolvedValue('warm');
    await expect(runOnWarmIosSimulatorAsync(claim, run)).resolves.toBe('warm');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(warm);
  });

  it('stops warmup and runs cold after an adoption failure', async () => {
    jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(warm);
    const run = jest
      .fn()
      .mockRejectedValueOnce(new WarmSessionAdoptionError())
      .mockResolvedValueOnce('cold');
    await expect(runOnWarmIosSimulatorAsync(claim, run)).resolves.toBe('cold');
    expect(warm.process.stopAsync).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith(undefined);
  });

  it('does not run cold after a failure during the session', async () => {
    jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(warm);
    const error = new Error('session failed');
    const run = jest.fn().mockRejectedValue(error);
    await expect(runOnWarmIosSimulatorAsync(claim, run)).rejects.toBe(error);
    expect(warm.process.stopAsync).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([new Error('session failed'), new WarmSessionAdoptionError()])(
    'preserves both errors and does not run cold when cleanup fails (%s)',
    async error => {
      jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(warm);
      const cleanupError = new Error('cleanup failed');
      jest.mocked(warm.process.stopAsync).mockRejectedValue(cleanupError);
      const run = jest.fn().mockRejectedValue(error);
      await expect(runOnWarmIosSimulatorAsync(claim, run)).rejects.toMatchObject({
        errors: [error, cleanupError],
      });
      expect(run).toHaveBeenCalledTimes(1);
    }
  );

  it.each([false, true])(
    'waits for cleanup before settling (adoption failure: %s)',
    async adoption => {
      jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(warm);
      const error = adoption ? new WarmSessionAdoptionError() : new Error('session failed');
      let releaseCleanup = () => {};
      let cleanupStarted = () => {};
      const started = new Promise<void>(resolve => {
        cleanupStarted = resolve;
      });
      jest.mocked(warm.process.stopAsync).mockImplementation(() => {
        cleanupStarted();
        return new Promise<void>(resolve => {
          releaseCleanup = resolve;
        });
      });
      const run = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('cold');
      const running = runOnWarmIosSimulatorAsync(claim, run);
      let settled = false;
      const result = running.then(
        value => {
          settled = true;
          return value;
        },
        error => {
          settled = true;
          return error;
        }
      );
      await started;
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(run).toHaveBeenCalledTimes(1);
      releaseCleanup();
      expect(await result).toBe(adoption ? 'cold' : error);
      expect(run).toHaveBeenCalledTimes(adoption ? 2 : 1);
    }
  );

  it('does not retry cold when cancellation occurs during cleanup', async () => {
    jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(warm);
    const controller = new AbortController();
    const cancellation = new Error('cancelled');
    jest.mocked(warm.process.stopAsync).mockImplementation(async () => {
      controller.abort(cancellation);
    });
    const run = jest.fn().mockRejectedValue(new WarmSessionAdoptionError());
    await expect(
      runOnWarmIosSimulatorAsync({ ...claim, signal: controller.signal }, run)
    ).rejects.toBe(cancellation);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
