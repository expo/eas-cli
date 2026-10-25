import { type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createWarmSimulatorSession } from '../commands/start';
import { shutdownSimulatorAsync, stopServicesAndShutdownSimulatorAsync } from '../commands/stop';
import { startAgentDevicePreparation, stopAgentDeviceDaemonAsync } from '../utils/agentDevice';
import { prepareArgentEnvironmentAsync, startArgentServer } from '../utils/argent';
import { startExpoGoPreinstall } from '../utils/expoGo';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
  terminateProcessGroupAsync,
} from '../utils/processes';
import { startServeSim, waitForServeSimReadyAsync } from '../utils/serveSim';

jest.mock('../commands/stop');
jest.mock('../utils/agentDevice');
jest.mock('../utils/argent');
jest.mock('../utils/expoGo');
jest.mock('../utils/processes');
jest.mock('../utils/serveSim');

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(predicate()).toBe(true);
}
function handle(pid: number): ChildProcessHandle {
  return { child: { pid } as ChildProcess, resultPromise: Promise.resolve('') };
}
const serveSim = handle(10);
const agent = handle(11);
const argent = handle(12);
let controller: AbortController;
let environment: NodeJS.ProcessEnv;
let onPreparationFailure: jest.Mock;
let onBackgroundFailure: jest.Mock;

function createSession() {
  return createWarmSimulatorSession({
    signal: controller.signal,
    throwIfStoppingAsync: async () => controller.signal.throwIfAborted(),
    onPreparationFailure,
    onBackgroundFailure,
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  environment = { ...process.env };
  delete process.env.EXPO_SIMULATOR_DEVICE;
  process.env.AGENT_DEVICE_STATE_DIR = '/isolated-session-fixture/agent';
  process.env.ARGENT_EVENT_LOG = '/isolated-session-fixture/events';
  jest.spyOn(os, 'homedir').mockReturnValue('/isolated-session-fixture');
  controller = new AbortController();
  onPreparationFailure = jest.fn(error => controller.abort(error));
  onBackgroundFailure = jest.fn(error => controller.abort(error));
  jest.mocked(commands.runAsync).mockImplementation(async (_file, args) => {
    if (args.includes('launchctl') && args.includes('list')) {
      throw Object.assign(new Error('apsd is not loaded'), { code: 113 });
    }
    return args.includes('devices')
      ? JSON.stringify({ devices: { ios: [{ udid: 'PHONE', name: 'iPhone 17' }] } })
      : 'native-start-time';
  });
  jest.mocked(startServeSim).mockReturnValue(serveSim);
  jest.mocked(startAgentDevicePreparation).mockReturnValue(agent);
  jest.mocked(startArgentServer).mockReturnValue(argent);
  jest.mocked(startExpoGoPreinstall).mockReturnValue({
    claimAsync: jest.fn(async () => undefined),
    stopAsync: jest.fn(async () => {}),
    resultPromise: Promise.resolve(),
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = environment;
});

it('creates an idle owner synchronously and stops services acquired before a tool fails', async () => {
  const argentPreparation = deferred();
  const failure = new Error('Argent preparation failed');
  jest.mocked(prepareArgentEnvironmentAsync).mockReturnValueOnce(argentPreparation.promise);
  const session = createSession();
  expect(commands.runAsync).not.toHaveBeenCalled();
  try {
    // serve-sim readiness makes the session claimable while the tools are still starting.
    await session.prepareAsync();
    expect(startAgentDevicePreparation).toHaveBeenCalledTimes(1);
    argentPreparation.reject(failure);
    await until(() => onPreparationFailure.mock.calls.length > 0);
    expect(onPreparationFailure).toHaveBeenCalledWith(failure);
    expect(onBackgroundFailure).not.toHaveBeenCalled();
    await session.stopAsync();
    expect(stopServicesAndShutdownSimulatorAsync).toHaveBeenCalledWith(
      new Set([serveSim, agent]),
      ['PHONE'],
      agent
    );
    expect(startArgentServer).not.toHaveBeenCalled();
  } finally {
    argentPreparation.reject(failure);
  }
});

it('disables apsd after boot and before the device is reported ready', async () => {
  const apsdBootout = deferred<string>();
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest
    .mocked(commands.runAsync)
    .mockImplementation((file, args, signal) =>
      args.includes('bootout') && args.includes('user/foreground/com.apple.apsd')
        ? apsdBootout.promise
        : original(file, args, signal)
    );
  const session = createSession();
  let ready = false;
  const preparing = session.prepareAsync().then(info => {
    ready = true;
    return info;
  });
  try {
    await until(() =>
      jest.mocked(commands.runAsync).mock.calls.some(([, args]) => args.includes('bootout'))
    );
    const calls = jest.mocked(commands.runAsync).mock.calls.map(([, args]) => args.join(' '));
    expect(calls.findIndex(call => call.includes('bootstatus PHONE'))).toBeLessThan(
      calls.indexOf('simctl spawn PHONE launchctl disable user/foreground/com.apple.apsd')
    );
    await new Promise(resolve => setImmediate(resolve));
    expect(ready).toBe(false);
    apsdBootout.resolve('');
    await preparing;
    expect(calls).toContain('simctl spawn PHONE launchctl disable user/foreground/com.apple.apsd');
  } finally {
    apsdBootout.resolve('');
  }
});

it('keeps the warm session when apsd cannot be disabled', async () => {
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest
    .mocked(commands.runAsync)
    .mockImplementation(async (file, args, signal) =>
      args.includes('launchctl') && args.includes('disable')
        ? Promise.reject(new Error('launchctl unavailable'))
        : original(file, args, signal)
    );
  const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  const session = createSession();
  expect(await session.prepareAsync()).toMatchObject({ device: { udid: 'PHONE' } });
  expect(stderr).toHaveBeenCalledWith(
    expect.stringContaining('Could not disable apsd on PHONE; continuing')
  );
  expect(onPreparationFailure).not.toHaveBeenCalled();
});

it('starts tools in the Simulator only after serve-sim is ready', async () => {
  const serveSimReady = deferred<void>();
  jest.mocked(waitForServeSimReadyAsync).mockReturnValueOnce(serveSimReady.promise);
  const session = createSession();
  const preparing = session.prepareAsync();
  try {
    await until(() => jest.mocked(startServeSim).mock.calls.length > 0);
    await new Promise(resolve => setImmediate(resolve));
    // Argent's configuration does not touch the Simulator, so it may run early.
    expect(prepareArgentEnvironmentAsync).toHaveBeenCalled();
    expect(startAgentDevicePreparation).not.toHaveBeenCalled();
    expect(startArgentServer).not.toHaveBeenCalled();
    serveSimReady.resolve();
    await preparing;
    await until(() => jest.mocked(startArgentServer).mock.calls.length > 0);
    expect(startAgentDevicePreparation).toHaveBeenCalledWith('PHONE', expect.anything());
  } finally {
    serveSimReady.resolve();
  }
});

it('serve-sim claim during agent-device prepare stops it and returns without waiting', async () => {
  const preparing = deferred<string>();
  const prepare = { child: { pid: 11 } as ChildProcess, resultPromise: preparing.promise };
  jest.mocked(startAgentDevicePreparation).mockReturnValueOnce(prepare);
  jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async job => {
    if (job === prepare) {
      preparing.reject(new Error('stopped'));
    }
  });
  const session = createSession();
  try {
    await session.prepareAsync();
    expect(await session.claimAsync({ engine: 'serve-sim' })).toEqual({
      device: { udid: 'PHONE', name: 'iPhone 17' },
    });
    await until(() => jest.mocked(stopAgentDeviceDaemonAsync).mock.calls.length > 0);
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(prepare, true);
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(argent);
    expect(onPreparationFailure).not.toHaveBeenCalled();
    await session.stopAsync();
    expect(stopServicesAndShutdownSimulatorAsync).toHaveBeenCalledWith(
      new Set([serveSim]),
      ['PHONE'],
      undefined
    );
  } finally {
    preparing.reject(new Error('stopped'));
  }
});

it('claim waits only for the requested tool and stops the other one mid-start', async () => {
  const preparing = deferred<string>();
  const prepare = { child: { pid: 11 } as ChildProcess, resultPromise: preparing.promise };
  const argentConfig = deferred();
  jest.mocked(startAgentDevicePreparation).mockReturnValueOnce(prepare);
  jest.mocked(prepareArgentEnvironmentAsync).mockReturnValueOnce(argentConfig.promise);
  jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async job => {
    if (job === prepare) {
      preparing.reject(new Error('stopped'));
    }
  });
  const session = createSession();
  try {
    await session.prepareAsync();
    let claimed = false;
    const claiming = session.claimAsync({ engine: 'argent' }).then(device => {
      claimed = true;
      return device;
    });
    await until(() => jest.mocked(stopAgentDeviceDaemonAsync).mock.calls.length > 0);
    expect(claimed).toBe(false);
    expect(startArgentServer).not.toHaveBeenCalled();
    argentConfig.resolve();
    expect(await claiming).toMatchObject({ device: { udid: 'PHONE' } });
    expect(startArgentServer).toHaveBeenCalledTimes(1);
    expect(onPreparationFailure).not.toHaveBeenCalled();
  } finally {
    preparing.reject(new Error('stopped'));
    argentConfig.resolve();
  }
});

it('replacement starts new services once the old serve-sim exits, without waiting for the old device shutdown', async () => {
  const serveSimStop = deferred<void>();
  const oldShutdown = deferred<string>();
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation(async (file, args, signal) =>
    args.includes('devices')
      ? JSON.stringify({
          devices: {
            ios: [
              { udid: 'PHONE', name: 'iPhone 17' },
              { udid: 'PRO', name: 'iPhone 17 Pro' },
            ],
          },
        })
      : original(file, args, signal)
  );
  jest.mocked(shutdownSimulatorAsync).mockImplementation(async () => {
    await oldShutdown.promise;
  });
  jest.mocked(terminateProcessGroupAsync).mockReturnValueOnce(serveSimStop.promise);
  const session = createSession();
  try {
    await session.prepareAsync();
    jest.mocked(startAgentDevicePreparation).mockClear();
    jest.mocked(startArgentServer).mockClear();
    jest.mocked(startServeSim).mockClear();
    const claiming = session.claimAsync({ engine: 'agent-device', requestedDevice: 'PRO' });
    await until(() =>
      jest
        .mocked(commands.runAsync)
        .mock.calls.some(([, args]) => args.includes('bootstatus') && args.includes('PRO'))
    );
    expect(terminateProcessGroupAsync).toHaveBeenCalledWith(serveSim);
    expect(startServeSim).not.toHaveBeenCalled();
    expect(startAgentDevicePreparation).not.toHaveBeenCalled();
    serveSimStop.resolve();
    // The claim returns while the old device is still shutting down.
    expect(await claiming).toEqual({ device: { udid: 'PRO', name: 'iPhone 17 Pro' } });
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE');
    expect(startServeSim).toHaveBeenCalledWith('PRO', controller.signal);
    expect(commands.runAsync).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'spawn', 'PRO', 'launchctl', 'disable', 'user/foreground/com.apple.apsd'],
      controller.signal
    );
    expect(startAgentDevicePreparation).toHaveBeenCalledWith('PRO', expect.anything());
    expect(startArgentServer).not.toHaveBeenCalled();
    // Terminal cleanup waits for the background shutdown, then owns only the new device.
    let stopped = false;
    const stopping = session.stopAsync().then(() => {
      stopped = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    expect(stopServicesAndShutdownSimulatorAsync).not.toHaveBeenCalled();
    oldShutdown.resolve('');
    await stopping;
    expect(stopServicesAndShutdownSimulatorAsync).toHaveBeenCalledTimes(1);
    expect(stopServicesAndShutdownSimulatorAsync).toHaveBeenCalledWith(
      expect.any(Set),
      ['PRO'],
      agent
    );
  } finally {
    serveSimStop.resolve();
    oldShutdown.resolve('');
  }
});

it('fails a replacement only after every old stop settles', async () => {
  const serveSimStop = deferred<void>();
  const daemonFailure = new Error('daemon stop failed');
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation(async (file, args, signal) =>
    args.includes('devices')
      ? JSON.stringify({
          devices: {
            ios: [
              { udid: 'PHONE', name: 'iPhone 17' },
              { udid: 'PRO', name: 'iPhone 17 Pro' },
            ],
          },
        })
      : original(file, args, signal)
  );
  jest.mocked(terminateProcessGroupAsync).mockReturnValueOnce(serveSimStop.promise);
  jest.mocked(stopAgentDeviceDaemonAsync).mockRejectedValueOnce(daemonFailure);
  const session = createSession();
  try {
    await session.prepareAsync();
    let settled = false;
    const claiming = session.claimAsync({ engine: 'serve-sim', requestedDevice: 'PRO' }).then(
      () => {
        settled = true;
      },
      error => {
        settled = true;
        return error;
      }
    );
    await until(() => jest.mocked(stopAgentDeviceDaemonAsync).mock.calls.length > 0);
    await new Promise(resolve => setImmediate(resolve));
    // The old serve-sim is still stopping, so the replacement has not failed yet.
    expect(settled).toBe(false);
    expect(stopServicesAndShutdownSimulatorAsync).not.toHaveBeenCalled();
    serveSimStop.resolve();
    expect(await claiming).toBe(daemonFailure);
  } finally {
    serveSimStop.resolve();
  }
});

it('keeps a replaced device owned when its background shutdown fails', async () => {
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation(async (file, args, signal) =>
    args.includes('devices')
      ? JSON.stringify({
          devices: {
            ios: [
              { udid: 'PHONE', name: 'iPhone 17' },
              { udid: 'PRO', name: 'iPhone 17 Pro' },
            ],
          },
        })
      : original(file, args, signal)
  );
  jest.mocked(shutdownSimulatorAsync).mockRejectedValueOnce(new Error('shutdown failed'));
  const session = createSession();
  await session.prepareAsync();
  await session.claimAsync({ engine: 'serve-sim', requestedDevice: 'PRO' });
  await session.stopAsync();
  expect(
    jest.mocked(stopServicesAndShutdownSimulatorAsync).mock.calls.map(([, udids]) => udids)
  ).toEqual([['PHONE', 'PRO']]);
  expect(onBackgroundFailure).not.toHaveBeenCalled();
});

it('drains unused tools and the whole Expo Go task before native cleanup, retaining their failure', async () => {
  const unusedAgent = deferred<void>();
  const unusedArgent = deferred<void>();
  const expoCleanup = deferred();
  const failure = new Error('Argent stop failed');
  const preinstall = {
    claimAsync: jest.fn(async () => undefined),
    stopAsync: jest.fn(() => expoCleanup.promise),
    resultPromise: expoCleanup.promise,
  };
  jest.mocked(startExpoGoPreinstall).mockReturnValueOnce(preinstall);
  jest
    .mocked(stopProcessAndDescendantsAsync)
    .mockImplementation(async job => (job === argent ? await unusedArgent.promise : undefined));
  jest.mocked(stopAgentDeviceDaemonAsync).mockReturnValueOnce(unusedAgent.promise);
  const session = createSession();
  expect(await session.prepareAsync()).toMatchObject({
    device: { udid: 'PHONE' },
    controllerPid: process.pid,
    controllerStartTime: 'native-start-time',
    agentDeviceStateDir: '/isolated-session-fixture/agent',
    argentEventLogPath: '/isolated-session-fixture/events',
  });
  expect(await session.claimAsync({ engine: 'serve-sim' })).toEqual({
    device: { udid: 'PHONE', name: 'iPhone 17' },
  });
  expect(preinstall.claimAsync).toHaveBeenCalledTimes(1);
  const stopping = session.stopAsync();
  const rejected = expect(stopping).rejects.toMatchObject({ errors: [failure] });
  try {
    unusedArgent.reject(failure);
    await new Promise(resolve => setImmediate(resolve));
    expect(onBackgroundFailure).toHaveBeenCalledWith(failure);
    expect(stopServicesAndShutdownSimulatorAsync).not.toHaveBeenCalled();
    unusedAgent.resolve();
    await new Promise(resolve => setImmediate(resolve));
    expect(stopServicesAndShutdownSimulatorAsync).not.toHaveBeenCalled();
    expoCleanup.resolve();
    await rejected;
    expect(stopServicesAndShutdownSimulatorAsync).toHaveBeenCalledWith(
      new Set([serveSim, argent]),
      ['PHONE'],
      undefined
    );
  } finally {
    unusedArgent.reject(failure);
    unusedAgent.resolve();
    expoCleanup.resolve();
    await stopping.catch(() => {});
  }
});

describe('waitForServeSimReadyAsync', () => {
  const { waitForServeSimReadyAsync } =
    jest.requireActual<typeof import('../utils/serveSim')>('../utils/serveSim');

  it('waits for the state file and a ready /readyz answer for this device', async () => {
    const tmpdir = await fs.mkdtemp(
      path.join(jest.requireActual<typeof os>('node:os').tmpdir(), 'serve-sim-ready-')
    );
    jest.spyOn(os, 'tmpdir').mockReturnValue(tmpdir);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'starting' })))
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ready', device: 'phone' })));
    try {
      const running = {
        child: { pid: 10 } as ChildProcess,
        resultPromise: new Promise<string>(() => {}),
      };
      const waiting = waitForServeSimReadyAsync('PHONE', running, controller.signal);
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(fetchSpy).not.toHaveBeenCalled();
      await fs.mkdir(path.join(tmpdir, 'serve-sim'));
      await fs.writeFile(
        path.join(tmpdir, 'serve-sim', 'server-PHONE.json'),
        JSON.stringify({ device: 'PHONE', url: 'http://127.0.0.1:3200', token: 'secret' })
      );
      await waiting;
      expect(fetchSpy).toHaveBeenLastCalledWith('http://127.0.0.1:3200/readyz', {
        signal: expect.any(AbortSignal),
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true });
    }
  });

  it('reads serve-sim state from SERVE_SIM_STATE_DIR when it is set', async () => {
    const stateDir = await fs.mkdtemp(
      path.join(jest.requireActual<typeof os>('node:os').tmpdir(), 'serve-sim-state-')
    );
    process.env.SERVE_SIM_STATE_DIR = stateDir;
    jest.spyOn(os, 'tmpdir').mockReturnValue('/missing-serve-sim-fixture');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ready', device: 'PHONE' })));
    try {
      await fs.writeFile(
        path.join(stateDir, 'server-PHONE.json'),
        JSON.stringify({ device: 'PHONE', url: 'http://127.0.0.1:3200', token: 'secret' })
      );
      const running = {
        child: { pid: 10 } as ChildProcess,
        resultPromise: new Promise<string>(() => {}),
      };
      await waitForServeSimReadyAsync('PHONE', running, controller.signal);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it('fails without an unhandled rejection when serve-sim exits with an error', async () => {
    jest.spyOn(os, 'tmpdir').mockReturnValue('/missing-serve-sim-fixture');
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const crashed = {
        child: { pid: 10 } as ChildProcess,
        resultPromise: Promise.reject(new Error('bunx exited with SIGTERM.')),
      };
      await expect(waitForServeSimReadyAsync('PHONE', crashed, controller.signal)).rejects.toThrow(
        'serve-sim exited before PHONE became ready.'
      );
      await new Promise(resolve => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('fails when serve-sim exits before it is ready', async () => {
    jest.spyOn(os, 'tmpdir').mockReturnValue('/missing-serve-sim-fixture');
    const exited = { child: { pid: 10 } as ChildProcess, resultPromise: Promise.resolve('') };
    await expect(waitForServeSimReadyAsync('PHONE', exited, controller.signal)).rejects.toThrow(
      'serve-sim exited before PHONE became ready.'
    );
  });
});

describe('prepareArgentEnvironmentAsync', () => {
  const { prepareArgentEnvironmentAsync: prepareActual } =
    jest.requireActual<typeof import('../utils/argent')>('../utils/argent');

  it('warns without installing ffmpeg when the image does not provide it', async () => {
    jest.mocked(commands.runAsync).mockImplementation(async file => {
      if (file === 'ffmpeg') {
        throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
      }
      return '';
    });
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    await prepareActual(controller.signal);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ffmpeg is unavailable'));
    expect(
      jest
        .mocked(commands.runAsync)
        .mock.calls.some(([file, args]) => file.includes('brew') || args.includes('brew'))
    ).toBe(false);
    expect(commands.runAsync).toHaveBeenCalledWith(
      'bunx',
      [expect.stringMatching(/^@swmansion\/argent@/), 'enable', 'artifacts-list-endpoint'],
      controller.signal
    );
  });
});

it('reports the preinstalled Expo Go only for the device it was installed on', async () => {
  const preinstalledExpoGo = {
    udid: 'PHONE',
    bundleIdentifier: 'host.exp.Exponent',
    shortVersion: '58.0.7',
    version: '58.0.7',
  };
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation(async (file, args, signal) =>
    args.includes('devices')
      ? JSON.stringify({
          devices: {
            ios: [
              { udid: 'PHONE', name: 'iPhone 17' },
              { udid: 'PRO', name: 'iPhone 17 Pro' },
            ],
          },
        })
      : original(file, args, signal)
  );
  for (const requestedDevice of [undefined, 'PRO']) {
    jest.mocked(startExpoGoPreinstall).mockReturnValueOnce({
      claimAsync: jest.fn(async () => preinstalledExpoGo),
      stopAsync: jest.fn(async () => {}),
      resultPromise: Promise.resolve(),
    });
    const session = createSession();
    await session.prepareAsync();
    const claimed = await session.claimAsync({ engine: 'serve-sim', requestedDevice });
    expect(claimed.preinstalledExpoGo).toEqual(requestedDevice ? undefined : preinstalledExpoGo);
  }
});

it('rejects serve-sim state that points readiness at another address', async () => {
  const { waitForServeSimReadyAsync: waitActual } =
    jest.requireActual<typeof import('../utils/serveSim')>('../utils/serveSim');
  const stateDir = await fs.mkdtemp(
    path.join(jest.requireActual<typeof os>('node:os').tmpdir(), 'serve-sim-state-')
  );
  process.env.SERVE_SIM_STATE_DIR = stateDir;
  const fetchSpy = jest.spyOn(global, 'fetch');
  try {
    await fs.writeFile(
      path.join(stateDir, 'server-PHONE.json'),
      JSON.stringify({ device: 'PHONE', url: 'http://example.test:3200', token: 'secret' })
    );
    const running = {
      child: { pid: 10 } as ChildProcess,
      resultPromise: new Promise<string>(() => {}),
    };
    await expect(waitActual('PHONE', running, controller.signal)).rejects.toThrow(
      'not http://127.0.0.1:3200'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
