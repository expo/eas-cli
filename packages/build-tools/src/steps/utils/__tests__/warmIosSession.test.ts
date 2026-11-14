import { type bunyan } from '@expo/logger';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runSimulatorLauncherAsync, stopWarmSimulatorAsync } from '../../../utils/warmSimulator';
import { readLocalEgressHandoffAsync } from '../localEgress';
import { createProcessOutput } from '../processOutput';
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
const previewLogger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const env = { EAS_USE_WARM_SIMULATOR: '1' };
const claim = {
  status: 'claimed',
  device: { udid: 'UDID', name: 'iPhone 17' },
  server: { pid: 10, port: 3200, token: 'serve-token', url: 'http://127.0.0.1:3200' },
  agentDeviceStateDir: '/agent',
  argentEventLogPath: '/argent/events',
  serveSimLogPath: '/logs/serve-sim.log',
  argentLogPath: '/logs/argent.log',
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
  expect(spawnDetached).not.toHaveBeenCalled();
  session?.forwardServerLogs?.(previewLogger);
  expect(spawnDetached).toHaveBeenCalledWith(
    expect.objectContaining({
      logger: previewLogger,
      command: '/usr/bin/tail',
      args: ['-n', '0', '-F', '/logs/serve-sim.log'],
      secrets: ['serve-token'],
    })
  );
  expect(session?.process.getOutput()).toBe('server output');
  session?.redactLogs?.(['adoption-secret']);
  expect(jest.mocked(spawnDetached).mock.calls[0][0].secrets).toEqual([
    'serve-token',
    'adoption-secret',
  ]);
  jest.mocked(stopWarmSimulatorAsync).mockRejectedValue(new Error('cleanup failed'));
  await expect(session?.process.stopAsync()).rejects.toThrow('cleanup failed');
  expect(stopReader).toHaveBeenCalledTimes(1);
});

it('forwards new agent-device daemon logs with its token redacted and stops both readers', async () => {
  const stopServerReader = jest.fn().mockRejectedValue(new Error('server reader failed'));
  const stopDaemonReader = jest.fn().mockRejectedValue(new Error('daemon reader failed'));
  jest
    .mocked(spawnDetached)
    .mockReturnValueOnce({
      pid: 99,
      getOutput: () => 'server output',
      getExitError: () => undefined,
      stopAsync: stopServerReader,
    })
    .mockReturnValueOnce({
      pid: 100,
      getOutput: () => 'daemon output',
      getExitError: () => undefined,
      stopAsync: stopDaemonReader,
    });
  jest
    .spyOn(fs, 'readFile')
    .mockResolvedValue(JSON.stringify({ pid: 20, httpPort: 4310, token: 'agent-token' }));
  const session = await tryClaimWarmIosSessionAsync({ engine: 'agent-device', env, logger });
  session?.forwardServerLogs?.(previewLogger);
  expect(spawnDetached).toHaveBeenCalledTimes(1);
  await session!.prepareToolsAsync();
  expect(spawnDetached).toHaveBeenLastCalledWith(
    expect.objectContaining({
      command: '/usr/bin/tail',
      args: ['-n', '0', '-F', '/agent/daemon.log'],
      logger,
      secrets: ['serve-token', 'agent-token'],
    })
  );
  expect(session!.process.getOutput()).toBe('server output\ndaemon output');
  await expect(session!.process.stopAsync()).resolves.toBeUndefined();
  expect(stopServerReader).toHaveBeenCalledTimes(1);
  expect(stopDaemonReader).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith('Could not stop forwarding agent-device daemon logs.');
  await expect(session!.process.stopAsync()).resolves.toBeUndefined();
  expect(stopDaemonReader).toHaveBeenCalledTimes(1);
});

it('keeps a prepared agent-device session when its daemon log reader cannot start', async () => {
  jest
    .spyOn(fs, 'readFile')
    .mockResolvedValue(JSON.stringify({ pid: 20, httpPort: 4310, token: 'agent-token' }));
  jest.mocked(spawnDetached).mockImplementationOnce(() => {
    throw new Error('tail unavailable');
  });
  const session = await tryClaimWarmIosSessionAsync({ engine: 'agent-device', env, logger });
  await expect(session!.prepareToolsAsync()).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledWith('Could not forward agent-device daemon logs.');
  expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
});

it('keeps the claimed Simulator when its server log reader cannot start', async () => {
  jest.mocked(spawnDetached).mockImplementation(() => {
    throw new Error('tail unavailable');
  });
  const session = await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger });
  session?.forwardServerLogs?.(previewLogger);
  expect(session?.server).toEqual({ pid: 10, port: 3200, token: 'serve-token' });
  expect(previewLogger.warn).toHaveBeenCalledWith('Could not forward warm Simulator server logs.');
  expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
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
    session?.forwardServerLogs?.(previewLogger);
    if (cleanupFails) {
      await expect(session!.process.stopAsync()).rejects.toThrow('Simulator cleanup failed');
    } else {
      await expect(session!.process.stopAsync()).resolves.toBeUndefined();
    }
    expect(previewLogger.warn).toHaveBeenCalledWith(
      'Could not stop forwarding warm Simulator server logs.'
    );
    expect(stopReader).toHaveBeenCalledTimes(1);
  }
);

it('adopts an older launcher without forwarding its mixed console log', async () => {
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockResolvedValue(JSON.stringify({ ...claim, serveSimLogPath: undefined }));
  const session = await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger });
  expect(session).toBeDefined();
  session!.forwardServerLogs!(previewLogger);
  expect(previewLogger.warn).toHaveBeenCalledWith(
    'The warm launcher does not provide a separate Simulator server log.'
  );
  expect(spawnDetached).not.toHaveBeenCalled();
  expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
});

it('keeps warm Argent console output in the controller step and serve-sim in preview', async () => {
  const outputs = new Map<string, ReturnType<typeof createProcessOutput>>();
  const stops: jest.Mock[] = [];
  jest.mocked(spawnDetached).mockImplementation(({ args, logger: outputLogger, secrets }) => {
    const output = createProcessOutput(outputLogger, secrets);
    outputs.set(args[3], output);
    const stop = jest.fn(async () => {
      output.finish();
    });
    stops.push(stop);
    return { pid: 99, getOutput: output.getOutput, getExitError: () => undefined, stopAsync: stop };
  });
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockImplementation(async ([command]) =>
      JSON.stringify(
        command === 'claim' ? claim : { tools: { pid: 30, port: 3201, token: 'argent-token' } }
      )
    );
  const session = await tryClaimWarmIosSessionAsync({ engine: 'argent', env, logger });
  session!.redactLogs!(['adoption-secret']);
  session!.forwardServerLogs!(previewLogger);
  await session!.prepareToolsAsync();
  outputs.get('/logs/serve-sim.log')!.stdout.append('Preview serve-token adoption-secret\n');
  outputs.get('/logs/argent.log')!.stderr.append('Controller argent-token adoption-secret\n');
  expect(previewLogger.info).toHaveBeenCalledWith(
    { source: 'stdout' },
    'Preview [REDACTED] [REDACTED]'
  );
  expect(logger.info).toHaveBeenCalledWith(
    { source: 'stderr' },
    'Controller [REDACTED] [REDACTED]'
  );
  expect(JSON.stringify(jest.mocked(previewLogger.info).mock.calls)).not.toContain('Controller');
  expect(JSON.stringify(jest.mocked(logger.info).mock.calls)).not.toContain('Preview');
  expect(session!.process.getOutput()).not.toMatch(/serve-token|argent-token|adoption-secret/);
  await session!.process.stopAsync();
  expect(stops).toHaveLength(2);
  for (const stop of stops) {
    expect(stop).toHaveBeenCalledTimes(1);
  }
  expect([...outputs.keys()]).toEqual(['/logs/serve-sim.log', '/logs/argent.log']);
});

it('keeps an older warm Argent launcher without forwarding mixed console output', async () => {
  jest
    .mocked(runSimulatorLauncherAsync)
    .mockImplementation(async ([command]) =>
      JSON.stringify(
        command === 'claim'
          ? { ...claim, argentLogPath: undefined }
          : { tools: { pid: 30, port: 3201, token: 'argent-token' } }
      )
    );
  const session = await tryClaimWarmIosSessionAsync({ engine: 'argent', env, logger });
  await session!.prepareToolsAsync();
  expect(session!.tools?.port).toBe(3201);
  expect(logger.warn).toHaveBeenCalledWith(
    'The warm launcher does not provide a separate controller log.'
  );
  expect(spawnDetached).not.toHaveBeenCalled();
  expect(stopWarmSimulatorAsync).not.toHaveBeenCalled();
});
