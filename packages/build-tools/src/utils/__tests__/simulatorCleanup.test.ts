import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { IosSimulatorUtils } from '../IosSimulatorUtils';
import { setSimulatorCleanupPromise } from '../simulatorCleanup';
import { launchApplicationAsync } from '../../steps/functions/launchApplication';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));

const logger = { info: jest.fn() } as any;
const cases: [string, () => Promise<unknown>][] = [
  [
    'device lookup',
    () => IosSimulatorUtils.getAvailableDevicesAsync({ env: {}, filter: 'available' }),
  ],
  ['boot', () => IosSimulatorUtils.bootAsync({ deviceIdentifier: 'UDID' as any, env: {} })],
  [
    'application launch',
    () =>
      launchApplicationAsync({
        applicationIdentifier: 'example.app',
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: {},
        logger,
      }),
  ],
];

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(spawn)
    .mockResolvedValue({ stdout: JSON.stringify({ devices: {} }), stderr: '' } as any);
});
afterEach(() => setSimulatorCleanupPromise(Promise.resolve()));

it.each(cases)('waits for confirmed cleanup before %s', async (_name, useSimulator) => {
  let finish!: () => void;
  setSimulatorCleanupPromise(
    new Promise<void>(resolve => {
      finish = resolve;
    })
  );
  let settled = false;
  const using = useSimulator().finally(() => {
    settled = true;
  });
  try {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    expect(spawn).not.toHaveBeenCalled();
    expect(settled).toBe(false);
  } finally {
    finish();
    await using;
  }
  expect(spawn).toHaveBeenCalled();
});

it.each(cases)('preserves cleanup failure and prevents %s', async (_name, useSimulator) => {
  const failure = new Error('Warm Simulator cleanup was not confirmed');
  const cleanup = Promise.reject(failure);
  void cleanup.catch(() => {});
  setSimulatorCleanupPromise(cleanup);
  await expect(useSimulator()).rejects.toBe(failure);
  await expect(useSimulator()).rejects.toBe(failure);
  expect(spawn).not.toHaveBeenCalled();
});
