import { type bunyan } from '@expo/logger';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runSimulatorLauncherAsync, stopWarmSimulatorAsync } from '../../../utils/warmSimulator';
import { readLocalEgressHandoffAsync } from '../localEgress';
import { tryClaimWarmIosSessionAsync } from '../warmIosSession';

jest.mock('../../../utils/warmSimulator');
jest.mock('../localEgress');

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const env = { EAS_USE_WARM_SIMULATOR: '1' };
const claim = {
  status: 'claimed',
  device: { udid: 'UDID', name: 'iPhone 17' },
  server: { pid: 10, port: 3200, token: 'serve-token', url: 'http://127.0.0.1:3200' },
  agentDeviceStateDir: '/agent',
  argentEventLogPath: '/argent/events',
  preinstalledExpoGo: { bundleIdentifier: 'host.exp.Exponent', shortVersion: '2.0', version: '1' },
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(stopWarmSimulatorAsync).mockResolvedValue();
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockImplementation(async ([command]) => (command === 'claim' ? JSON.stringify(claim) : '{}'));
});
afterEach(() => jest.restoreAllMocks());

it('does not claim when the job does not use the warm Simulator', async () => {
  await expect(
    tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env: {}, logger })
  ).resolves.toBeUndefined();
  expect(runSimulatorLauncherAsync).not.toHaveBeenCalled();
  expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
});

it('claims the requested device and returns the launcher record', async () => {
  const session = await tryClaimWarmIosSessionAsync({
    engine: 'serve-sim',
    requestedDevice: 'iPhone 17',
    env,
    logger,
  });
  expect(runSimulatorLauncherAsync).toHaveBeenCalledWith(['claim', 'serve-sim', 'iPhone 17'], {
    env,
    signal: undefined,
  });
  expect(session).toMatchObject({
    device: claim.device,
    server: { pid: 10, port: 3200, token: 'serve-token' },
    preinstalledExpoGo: claim.preinstalledExpoGo,
  });
  await session!.prepareToolsAsync();
  expect(runSimulatorLauncherAsync).toHaveBeenLastCalledWith(['prepare-tools'], {
    env,
    signal: undefined,
  });
  expect(session!.tools).toBeUndefined();
});

it('takes the preinstalled Expo Go that prepare-tools reports', async () => {
  const expoGo = { bundleIdentifier: 'host.exp.Exponent', shortVersion: '3.0', version: '2' };
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockImplementation(async ([command]) =>
      command === 'claim'
        ? JSON.stringify({ ...claim, preinstalledExpoGo: undefined })
        : JSON.stringify({ preinstalledExpoGo: expoGo })
    );
  const session = await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger });
  expect(session!.preinstalledExpoGo).toBeUndefined();
  await session!.prepareToolsAsync();
  expect(session!.preinstalledExpoGo).toEqual(expoGo);
});

it('reads the agent-device server after tool preparation', async () => {
  jest
    .spyOn(fs, 'readFile')
    .mockResolvedValue(JSON.stringify({ pid: 20, httpPort: 4310, token: 'agent-token' }));
  const session = await tryClaimWarmIosSessionAsync({ engine: 'agent-device', env, logger });
  await session!.prepareToolsAsync();
  expect(fs.readFile).toHaveBeenCalledWith(path.join('/agent', 'daemon.json'), 'utf8');
  expect(session!.tools).toEqual({ pid: 20, port: 4310, token: 'agent-token' });
});

it('uses the Argent identity validated by the launcher without scanning state files again', async () => {
  const tools = { pid: 30, port: 3201, token: 'argent-token' };
  const readDirectory = jest.spyOn(fs, 'readdir');
  const readFile = jest.spyOn(fs, 'readFile');
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockImplementation(async ([command]) =>
      JSON.stringify(command === 'claim' ? claim : { tools })
    );
  const session = await tryClaimWarmIosSessionAsync({ engine: 'argent', env, logger });
  await session?.prepareToolsAsync();
  expect(session?.tools).toEqual(tools);
  expect(readDirectory).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled();
});

it('rejects Argent preparation when the launcher returns no validated identity', async () => {
  const session = await tryClaimWarmIosSessionAsync({ engine: 'argent', env, logger });
  await expect(session?.prepareToolsAsync()).rejects.toThrow();
});

it.each([
  [
    'a failed claim',
    {},
    () => jest.mocked(runSimulatorLauncherAsync).mockRejectedValue(new Error('no session')),
  ],
  ['a pinned package version', { packageVersion: '1.2.3' }, () => {}],
  ['a job Simulator setting', { env: { ...env, SIMCTL_CHILD_FOO: '1' } }, () => {}],
])('stops warmup and returns nothing for %s', async (_name, options, setup) => {
  setup();
  await expect(
    tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger, ...options })
  ).resolves.toBeUndefined();
  expect(stopWarmSimulatorAsync).toHaveBeenCalledTimes(1);
});

it('rejects when warmup cleanup cannot be confirmed', async () => {
  jest.mocked(runSimulatorLauncherAsync).mockRejectedValue(new Error('no session'));
  jest.mocked(stopWarmSimulatorAsync).mockRejectedValue(new Error('cleanup failed'));
  await expect(tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })).rejects.toThrow(
    'cleanup failed'
  );
});

it('stops the claimed session once', async () => {
  const session = await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger });
  await Promise.all([session!.process.stopAsync(), session!.process.stopAsync()]);
  expect(stopWarmSimulatorAsync).toHaveBeenCalledTimes(1);
});

it('claims a local egress job without stopping warmup', async () => {
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue({ port: 8899 } as never);
  await expect(
    tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })
  ).resolves.toBeDefined();
  expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
});

it('stops warmup before claiming when the egress handoff is malformed', async () => {
  jest.mocked(readLocalEgressHandoffAsync).mockRejectedValue(new Error('malformed handoff'));
  await expect(
    tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })
  ).resolves.toBeUndefined();
  expect(runSimulatorLauncherAsync).not.toHaveBeenCalled();
  expect(stopWarmSimulatorAsync).toHaveBeenCalledTimes(1);
});
