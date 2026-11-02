import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { type CustomBuildContext } from '../../../customBuildContext';
import { IosSimulatorRecordingUtils } from '../IosSimulatorRecordingUtils';
import { fetchWebPreviewTurnArgsAsync } from '../remoteDeviceRunSession';
import { WarmSessionAdoptionError, createWarmDeviceSessionServer } from '../warmDeviceSessionHost';
import { type WarmIosSession } from '../warmIosSession';

jest.mock('@expo/turtle-spawn');
jest.mock('../IosSimulatorRecordingUtils');
jest.mock('../remoteDeviceRunSession', () => ({
  ...jest.requireActual('../remoteDeviceRunSession'),
  fetchWebPreviewTurnArgsAsync: jest.fn(),
}));

const ctx = {} as CustomBuildContext;
const logger = {} as bunyan;
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
