import { type bunyan } from '@expo/logger';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runSimulatorLauncherAsync, stopWarmSimulatorAsync } from '../../../utils/warmSimulator';
import { readLocalEgressHandoffAsync } from '../localEgress';
import { runOnWarmIosSimulatorAsync } from '../warmDeviceSessionHost';
import { spawnDetached } from '../remoteDeviceRunSession';
import { tryClaimWarmIosSessionAsync } from '../warmIosSession';

jest.mock('../../../utils/warmSimulator');
jest.mock('../localEgress');
jest.mock('../remoteDeviceRunSession', () => ({
  ...jest.requireActual('../remoteDeviceRunSession'),
  spawnDetached: jest.fn(),
}));

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

it('logs the wait before claiming, without logging the private launcher record', async () => {
  jest.mocked(runSimulatorLauncherAsync).mockImplementationOnce(async () => {
    expect(logger.info).toHaveBeenCalledWith('Waiting for the warm Simulator launcher.');
    return JSON.stringify(claim);
  });
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
  expect(jest.mocked(logger.info).mock.calls).toEqual([
    ['Waiting for the warm Simulator launcher.'],
    ['Claimed the warm Simulator iPhone 17 (UDID).'],
  ]);
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

it('keeps the exact serve-sim version from the launcher claim', async () => {
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockResolvedValueOnce(JSON.stringify({ ...claim, serveSimVersion: '0.13.3' }));
  const session = await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger });
  expect(session?.serveSimVersion).toBe('0.13.3');
});

it('stops warmup when the claim contains an invalid serve-sim version', async () => {
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockResolvedValueOnce(JSON.stringify({ ...claim, serveSimVersion: 'latest' }));
  await expect(
    tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })
  ).resolves.toBeUndefined();
  expect(stopWarmSimulatorAsync).toHaveBeenCalledTimes(1);
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
  ['a job Simulator setting', { env: { ...env, SIMCTL_CHILD_FOO: '1' } }, () => {}],
  [
    'a local egress session',
    {},
    () => jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue({ port: 1 } as never),
  ],
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

it.each([
  ['serve-sim', 'serveSimVersion'],
  ['agent-device', 'agentDeviceVersion'],
  ['argent', 'argentVersion'],
] as const)(
  'reuses %s only when its recorded version matches the resolved request',
  async (engine, field) => {
    jest
      .mocked(runSimulatorLauncherAsync)
      .mockResolvedValue(JSON.stringify({ ...claim, [field]: '1.2.3' }));
    await expect(
      tryClaimWarmIosSessionAsync({ engine, packageVersion: '1.2.3', env, logger })
    ).resolves.toBeDefined();
    expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
    await expect(
      tryClaimWarmIosSessionAsync({ engine, packageVersion: '1.2.4', env, logger })
    ).resolves.toBeUndefined();
    expect(stopWarmSimulatorAsync).toHaveBeenCalledTimes(1);
  }
);

it.each(['serve-sim', 'agent-device', 'argent'] as const)(
  'uses normal setup for %s when older claims omit its version',
  async engine => {
    await expect(
      tryClaimWarmIosSessionAsync({ engine, packageVersion: '1.2.3', env, logger })
    ).resolves.toBeUndefined();
    expect(stopWarmSimulatorAsync).toHaveBeenCalledTimes(1);
  }
);

it('accepts a resolved prerelease pin for matching warm adoption', async () => {
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockResolvedValue(JSON.stringify({ ...claim, serveSimVersion: '0.13.4-beta.1+build.2' }));
  await expect(
    tryClaimWarmIosSessionAsync({
      engine: 'serve-sim',
      packageVersion: '0.13.4-beta.1+build.2',
      env,
      logger,
    })
  ).resolves.toMatchObject({ serveSimVersion: '0.13.4-beta.1+build.2' });
  expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
});

it('preserves exact build metadata through job resolution and warm claim', async () => {
  const version = '0.13.4-beta.1+build.2';
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockResolvedValueOnce(JSON.stringify({ ...claim, serveSimVersion: version }));
  const run = jest.fn(async (session, resolvedVersion) => {
    expect(session?.serveSimVersion).toBe(version);
    expect(resolvedVersion).toBe(version);
    return 'warm';
  });
  await expect(
    runOnWarmIosSimulatorAsync(
      { engine: 'serve-sim', packageVersion: `v${version}`, env, logger },
      run
    )
  ).resolves.toBe('warm');
  expect(run).toHaveBeenCalledTimes(1);
  expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
});

it('forwards only new warm server output and stops the reader when warm cleanup fails', async () => {
  const stopReader = jest.fn().mockResolvedValue(undefined);
  jest.mocked(spawnDetached).mockReturnValue({
    pid: 99,
    getOutput: () => 'server output',
    getExitError: () => undefined,
    stopAsync: stopReader,
  });
  const session = await tryClaimWarmIosSessionAsync({
    engine: 'serve-sim',
    env: { ...env, HOME: '/Users/expo' },
    logger,
  });
  expect(spawnDetached).toHaveBeenCalledWith(
    expect.objectContaining({
      command: '/usr/bin/tail',
      args: ['-n', '0', '-F', '/Users/expo/Library/Logs/vm-tools.log'],
      secrets: ['serve-token'],
    })
  );
  expect(session?.process.getOutput()).toBe('server output');
  jest.mocked(stopWarmSimulatorAsync).mockRejectedValue(new Error('cleanup failed'));
  await expect(session?.process.stopAsync()).rejects.toThrow('cleanup failed');
  expect(stopReader).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'does not replace Simulator cleanup with a reader error (cleanup fails: %s)',
  async cleanupFails => {
    const stopReader = jest.fn().mockRejectedValue(new Error('reader drain failed'));
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 99,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopReader,
    });
    if (cleanupFails) {
      jest.mocked(stopWarmSimulatorAsync).mockRejectedValue(new Error('Simulator cleanup failed'));
    }
    const session = await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger });
    if (cleanupFails) {
      await expect(session!.process.stopAsync()).rejects.toThrow('Simulator cleanup failed');
    } else {
      await expect(session!.process.stopAsync()).resolves.toBeUndefined();
    }
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not stop forwarding warm Simulator server logs.'
    );
    expect(stopReader).toHaveBeenCalledTimes(1);
  }
);
