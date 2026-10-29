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
import { readLocalEgressHandoffAsync } from '../localEgress';
import { type WarmIosSession, tryClaimWarmIosSessionAsync } from '../warmIosSession';

jest.mock('@expo/turtle-spawn');
jest.mock('../IosSimulatorRecordingUtils');
jest.mock('../warmIosSession');
jest.mock('../localEgress');
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
      '--disable',
      'egressGuard',
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
    const run = jest.fn().mockRejectedValue(new Error('session failed'));
    await expect(runOnWarmIosSimulatorAsync(claim, run)).rejects.toThrow('session failed');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not run cold when warmup cleanup fails', async () => {
    jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValue(warm);
    jest.mocked(warm.process.stopAsync).mockRejectedValue(new Error('cleanup failed'));
    const run = jest.fn().mockRejectedValue(new WarmSessionAdoptionError());
    await expect(runOnWarmIosSimulatorAsync(claim, run)).rejects.toThrow('cleanup failed');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

it('enables the resident guard for a local egress adoption and retains the proxy argument', async () => {
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue({ port: 8899 } as never);
  const options = launch();
  options.args.push('--network-capture-proxy', 'http://127.0.0.1:8899');
  await createWarmDeviceSessionServer(ctx, logger, warm).startAsync(options);
  expect(spawn).toHaveBeenCalledWith(
    'bunx',
    expect.arrayContaining([
      '--network-capture-proxy',
      'http://127.0.0.1:8899',
      '--adopt',
      '--enable',
      'egressGuard',
    ]),
    expect.anything()
  );
});

it('does not prepare tools after resident policy admission rejects', async () => {
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue({ port: 8899 } as never);
  jest.mocked(spawn).mockRejectedValue(new Error('Resident egress enforcement is unavailable'));
  await expect(
    createWarmDeviceSessionServer(ctx, logger, warm).startAsync(launch())
  ).rejects.toBeInstanceOf(WarmSessionAdoptionError);
  expect(warm.prepareToolsAsync).not.toHaveBeenCalled();
});
