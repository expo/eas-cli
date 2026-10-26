import { type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createWarmSimulatorSession } from '../commands/start';
import { createArgentTool } from '../utils/argent';
import { startExpoGoPreinstall } from '../utils/expoGo';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
  terminateProcessGroupAsync,
} from '../utils/processes';
import { startServeSim, waitForServeSimReadyAsync } from '../utils/serveSim';
import { shutdownSimulatorAsync } from '../utils/simulator';
import { deferred, until } from './helpers';

jest.mock('../utils/expoGo');
jest.mock('../utils/processes');
jest.mock('../utils/serveSim');
jest.mock('../utils/simulator', () => ({
  ...jest.requireActual('../utils/simulator'),
  shutdownSimulatorAsync: jest.fn(),
}));

/** Calls that started a tool process whose arguments include `word`, e.g. `prepare` or `server`. */
function started(word: string) {
  return jest.mocked(commands.start).mock.calls.filter(([, args]) => args.includes(word));
}
function ran(...words: string[]) {
  return jest
    .mocked(commands.runAsync)
    .mock.calls.filter(([, args]) => words.every(word => args.includes(word)));
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
  jest
    .mocked(commands.start)
    .mockImplementation((_file, args) => (args.includes('prepare') ? agent : argent));
  jest.mocked(shutdownSimulatorAsync).mockResolvedValue();
  jest.mocked(stopProcessAndDescendantsAsync).mockResolvedValue();
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
  const argentPreparation = deferred<string>();
  const failure = new Error('Argent preparation failed');
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest
    .mocked(commands.runAsync)
    .mockImplementation((file, args, signal) =>
      args.includes('artifacts-list-endpoint')
        ? argentPreparation.promise
        : original(file, args, signal)
    );
  const session = createSession();
  expect(commands.runAsync).not.toHaveBeenCalled();
  try {
    // serve-sim readiness makes the session claimable while the tools are still starting.
    await session.prepareAsync();
    expect(started('prepare')).toHaveLength(1);
    argentPreparation.reject(failure);
    await until(() => onPreparationFailure.mock.calls.length > 0);
    expect(onPreparationFailure).toHaveBeenCalledWith(failure);
    expect(onBackgroundFailure).not.toHaveBeenCalled();
    await session.stopAsync();
    expect(jest.mocked(stopProcessAndDescendantsAsync).mock.calls).toEqual([
      [serveSim],
      [agent, true],
    ]);
    expect(ran('daemon', 'stop')).toHaveLength(1);
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE');
    expect(started('server')).toEqual([]);
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
    expect(commands.runAsync).toHaveBeenCalledWith('ffmpeg', ['-version'], expect.anything());
    expect(commands.start).not.toHaveBeenCalled();
    serveSimReady.resolve();
    await preparing;
    await until(() => started('server').length > 0);
    expect(started('prepare')[0][1]).toContain('PHONE');
  } finally {
    serveSimReady.resolve();
  }
});

it('serve-sim claim during agent-device prepare stops it and returns without waiting', async () => {
  const preparing = deferred<string>();
  const prepare = { child: { pid: 11 } as ChildProcess, resultPromise: preparing.promise };
  jest
    .mocked(commands.start)
    .mockImplementation((_file, args) => (args.includes('prepare') ? prepare : argent));
  jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async job => {
    if (job === prepare) {
      preparing.reject(new Error('stopped'));
    }
  });
  const session = createSession();
  try {
    await session.prepareAsync();
    expect(await session.claimAsync({ engine: 'serve-sim' })).toEqual({
      device: { udid: 'PHONE', name: 'iPhone 17', port: 3200 },
    });
    await until(() => ran('daemon', 'stop').length > 0);
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(prepare, true);
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(argent);
    expect(onPreparationFailure).not.toHaveBeenCalled();
    jest.mocked(stopProcessAndDescendantsAsync).mockClear();
    await session.stopAsync();
    // Only serve-sim is left; the stopped tools are not stopped again.
    expect(jest.mocked(stopProcessAndDescendantsAsync).mock.calls).toEqual([[serveSim]]);
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE');
  } finally {
    preparing.reject(new Error('stopped'));
  }
});

it('claim waits only for the requested tool and stops the other one mid-start', async () => {
  const preparing = deferred<string>();
  const prepare = { child: { pid: 11 } as ChildProcess, resultPromise: preparing.promise };
  const argentConfig = deferred<string>();
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest
    .mocked(commands.runAsync)
    .mockImplementation((file, args, signal) =>
      args.includes('artifacts-list-endpoint') ? argentConfig.promise : original(file, args, signal)
    );
  jest
    .mocked(commands.start)
    .mockImplementation((_file, args) => (args.includes('prepare') ? prepare : argent));
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
    await until(() => ran('daemon', 'stop').length > 0);
    expect(claimed).toBe(false);
    expect(started('server')).toEqual([]);
    argentConfig.resolve('');
    expect(await claiming).toMatchObject({ device: { udid: 'PHONE' } });
    expect(started('server')).toHaveLength(1);
    expect(onPreparationFailure).not.toHaveBeenCalled();
  } finally {
    preparing.reject(new Error('stopped'));
    argentConfig.resolve('');
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
    jest.mocked(commands.start).mockClear();
    jest.mocked(startServeSim).mockClear();
    const claiming = session.claimAsync({ engine: 'agent-device', requestedDevice: 'PRO' });
    await until(() =>
      jest
        .mocked(commands.runAsync)
        .mock.calls.some(([, args]) => args.includes('bootstatus') && args.includes('PRO'))
    );
    expect(terminateProcessGroupAsync).toHaveBeenCalledWith(serveSim);
    expect(startServeSim).not.toHaveBeenCalled();
    expect(commands.start).not.toHaveBeenCalled();
    serveSimStop.resolve();
    // The claim returns while the old device is still shutting down.
    expect(await claiming).toEqual({ device: { udid: 'PRO', name: 'iPhone 17 Pro', port: 3200 } });
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE');
    expect(startServeSim).toHaveBeenCalledWith('PRO', expect.any(AbortSignal), 3200);
    expect(commands.runAsync).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'spawn', 'PRO', 'launchctl', 'disable', 'user/foreground/com.apple.apsd'],
      expect.any(AbortSignal)
    );
    expect(started('prepare')).toHaveLength(1);
    expect(started('prepare')[0][1]).toContain('PRO');
    expect(started('server')).toEqual([]);
    // Terminal cleanup waits for the background shutdown, then owns only the new device.
    let stopped = false;
    const stopping = session.stopAsync().then(() => {
      stopped = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    expect(jest.mocked(shutdownSimulatorAsync).mock.calls).toEqual([['PHONE']]);
    oldShutdown.resolve('');
    await stopping;
    expect(jest.mocked(shutdownSimulatorAsync).mock.calls).toEqual([['PHONE'], ['PRO']]);
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(agent, true);
  } finally {
    serveSimStop.resolve();
    oldShutdown.resolve('');
  }
});

it('fails a replacement only after every old stop settles', async () => {
  const serveSimStop = deferred<void>();
  const daemonFailure = new Error('daemon stop failed');
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation(async (file, args, signal) => {
    if (args.includes('daemon') && ran('daemon', 'stop').length === 1) {
      throw daemonFailure;
    }
    return args.includes('devices')
      ? JSON.stringify({
          devices: {
            ios: [
              { udid: 'PHONE', name: 'iPhone 17' },
              { udid: 'PRO', name: 'iPhone 17 Pro' },
            ],
          },
        })
      : original(file, args, signal);
  });
  jest.mocked(terminateProcessGroupAsync).mockReturnValueOnce(serveSimStop.promise);
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
    await until(() => ran('daemon', 'stop').length > 0);
    await new Promise(resolve => setImmediate(resolve));
    // The old serve-sim is still stopping, so the replacement has not failed yet.
    expect(settled).toBe(false);
    expect(shutdownSimulatorAsync).not.toHaveBeenCalled();
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
  // The background shutdown of PHONE failed, so terminal cleanup shuts down both devices.
  expect(jest.mocked(shutdownSimulatorAsync).mock.calls).toEqual([['PHONE'], ['PHONE'], ['PRO']]);
  expect(onBackgroundFailure).not.toHaveBeenCalled();
});

it('drains unused tools and the whole Expo Go task before native cleanup, retaining their failure', async () => {
  const unusedAgent = deferred<string>();
  const unusedArgent = deferred<void>();
  let argentStopped = false;
  const expoCleanup = deferred();
  const failure = new Error('Argent stop failed');
  const preinstall = {
    claimAsync: jest.fn(async () => undefined),
    stopAsync: jest.fn(() => expoCleanup.promise),
    resultPromise: expoCleanup.promise,
  };
  jest.mocked(startExpoGoPreinstall).mockReturnValueOnce(preinstall);
  // The claim-time Argent stop fails; the terminal retry of that stop succeeds.
  jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async job => {
    if (job === argent && !argentStopped) {
      argentStopped = true;
      await unusedArgent.promise;
    }
  });
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest
    .mocked(commands.runAsync)
    .mockImplementation((file, args, signal) =>
      args.includes('daemon') && ran('daemon', 'stop').length === 1
        ? unusedAgent.promise
        : original(file, args, signal)
    );
  const session = createSession();
  expect(await session.prepareAsync()).toMatchObject({
    device: { udid: 'PHONE' },
    controllerPid: process.pid,
    controllerStartTime: 'native-start-time',
    agentDeviceStateDir: '/isolated-session-fixture/agent',
    argentEventLogPath: '/isolated-session-fixture/events',
  });
  expect(await session.claimAsync({ engine: 'serve-sim' })).toEqual({
    device: { udid: 'PHONE', name: 'iPhone 17', port: 3200 },
  });
  expect(preinstall.claimAsync).toHaveBeenCalledTimes(1);
  const stopping = session.stopAsync();
  const rejected = expect(stopping).rejects.toMatchObject({ errors: [failure] });
  try {
    unusedArgent.reject(failure);
    await new Promise(resolve => setImmediate(resolve));
    expect(onBackgroundFailure).toHaveBeenCalledWith(failure);
    expect(stopProcessAndDescendantsAsync).not.toHaveBeenCalledWith(serveSim);
    unusedAgent.resolve('');
    await new Promise(resolve => setImmediate(resolve));
    expect(stopProcessAndDescendantsAsync).not.toHaveBeenCalledWith(serveSim);
    expoCleanup.resolve();
    await rejected;
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(serveSim);
    expect(
      jest.mocked(stopProcessAndDescendantsAsync).mock.calls.filter(([job]) => job === argent)
    ).toHaveLength(2);
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE');
  } finally {
    unusedArgent.reject(failure);
    unusedAgent.resolve('');
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

describe('Argent preparation', () => {
  it('warns without installing ffmpeg when the image does not provide it', async () => {
    jest.mocked(commands.runAsync).mockImplementation(async file => {
      if (file === 'ffmpeg') {
        throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
      }
      return '';
    });
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    await createArgentTool().prepareAsync!(controller.signal);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('ffmpeg is unavailable'));
    expect(
      jest
        .mocked(commands.runAsync)
        .mock.calls.some(([file, args]) => file.includes('brew') || args.includes('brew'))
    ).toBe(false);
    expect(commands.runAsync).toHaveBeenCalledWith(
      'bunx',
      [expect.stringMatching(/^@swmansion\/argent@/), 'enable', 'artifacts-list-endpoint'],
      expect.any(AbortSignal)
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

it('warms additional devices only after the default is ready, with separate ports and preinstalls', async () => {
  process.env.EXPO_SIMULATOR_DEVICE = 'iPhone Duo,iPhone 18';
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation((file, args, signal) =>
    args.includes('devices')
      ? Promise.resolve(
          JSON.stringify({
            devices: {
              ios: [
                { udid: 'DUO', name: 'iPhone Duo' },
                { udid: 'PHONE18', name: 'iPhone 18' },
              ],
            },
          })
        )
      : original(file, args, signal)
  );
  const first = handle(201),
    second = handle(202);
  jest.mocked(startServeSim).mockImplementation(udid => (udid === 'DUO' ? first : second));
  const secondReady = deferred<void>();
  jest
    .mocked(waitForServeSimReadyAsync)
    .mockImplementation(udid => (udid === 'PHONE18' ? secondReady.promise : Promise.resolve()));
  const session = createSession();
  const info = await session.prepareAsync();
  expect(info.device).toEqual({ udid: 'DUO', name: 'iPhone Duo', port: 3200 });
  expect(info.devices).toEqual([
    { udid: 'DUO', name: 'iPhone Duo', port: 3200 },
    { udid: 'PHONE18', name: 'iPhone 18', port: 3202 },
  ]);
  expect(startServeSim).toHaveBeenCalledTimes(1);
  expect(startExpoGoPreinstall).toHaveBeenCalledTimes(1);
  session.startRemainingDevices();
  try {
    await until(() => jest.mocked(startServeSim).mock.calls.length === 2);
    expect(startExpoGoPreinstall).toHaveBeenCalledTimes(2);
    expect(startServeSim).toHaveBeenCalledWith('PHONE18', expect.any(AbortSignal), 3202);
    expect(started('prepare')).toHaveLength(1);
    expect(started('prepare')[0][1]).toContain('DUO');
    secondReady.resolve();
    await session.stopAsync();
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(first);
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(second);
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('DUO');
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE18');
  } finally {
    secondReady.resolve();
  }
});

function configureTwoDevices() {
  process.env.EXPO_SIMULATOR_DEVICE = 'iPhone Duo,iPhone 18';
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation((file, args, signal) =>
    args.includes('devices')
      ? Promise.resolve(
          JSON.stringify({
            devices: {
              ios: [
                { udid: 'DUO', name: 'iPhone Duo' },
                { udid: 'PHONE18', name: 'iPhone 18' },
                { udid: 'OTHER', name: 'iPhone Other' },
              ],
            },
          })
        )
      : original(file, args, signal)
  );
  const handles = { DUO: handle(201), PHONE18: handle(202), OTHER: handle(203) };
  jest.mocked(startServeSim).mockImplementation(udid => handles[udid as keyof typeof handles]);
  return handles;
}

it('claims the second warm device without rebooting or listing again, retiring the first in the background', async () => {
  const servers = configureTwoDevices();
  const oldServerStop = deferred<void>();
  jest
    .mocked(terminateProcessGroupAsync)
    .mockImplementation(server =>
      server === servers.DUO ? oldServerStop.promise : Promise.resolve()
    );
  const session = createSession();
  await session.prepareAsync();
  session.startRemainingDevices();
  await until(() => jest.mocked(startServeSim).mock.calls.length === 2);
  const listCalls = ran('devices').length;
  try {
    expect(await session.claimAsync({ engine: 'serve-sim', requestedDevice: 'phone18' })).toEqual({
      device: { udid: 'PHONE18', name: 'iPhone 18', port: 3202 },
    });
    expect(startServeSim).toHaveBeenCalledTimes(2);
    expect(ran('devices')).toHaveLength(listCalls);
    expect(ran('bootstatus', 'PHONE18')).toHaveLength(1);
    expect(terminateProcessGroupAsync).toHaveBeenCalledWith(servers.DUO);
    let stopped = false;
    const stopping = session.stopAsync().then(() => {
      stopped = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    oldServerStop.resolve();
    await stopping;
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('DUO');
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE18');
  } finally {
    oldServerStop.resolve();
  }
});

it('returns the default while unused-device Expo Go cleanup is pending, but terminal stop drains it', async () => {
  configureTwoDevices();
  const draining = deferred<void>();
  const defaultPreinstall = {
    claimAsync: jest.fn(async () => undefined),
    stopAsync: jest.fn(async () => {}),
    resultPromise: Promise.resolve(),
  };
  const secondPreinstall = {
    claimAsync: jest.fn(async () => undefined),
    stopAsync: jest.fn(() => draining.promise),
    resultPromise: Promise.resolve(),
  };
  jest
    .mocked(startExpoGoPreinstall)
    .mockReturnValueOnce(defaultPreinstall)
    .mockReturnValueOnce(secondPreinstall);
  const session = createSession();
  await session.prepareAsync();
  session.startRemainingDevices();
  await until(() => jest.mocked(startExpoGoPreinstall).mock.calls.length === 2);
  try {
    expect((await session.claimAsync({ engine: 'serve-sim' })).device.udid).toBe('DUO');
    expect(defaultPreinstall.claimAsync).toHaveBeenCalledTimes(1);
    expect(secondPreinstall.claimAsync).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = session.stopAsync().then(() => {
      stopped = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    expect(shutdownSimulatorAsync).not.toHaveBeenCalledWith('PHONE18');
    draining.resolve();
    await stopping;
  } finally {
    draining.resolve();
  }
});

it('waits for the selected secondary device before returning its port', async () => {
  configureTwoDevices();
  const ready = deferred<void>();
  jest
    .mocked(waitForServeSimReadyAsync)
    .mockImplementation(udid => (udid === 'PHONE18' ? ready.promise : Promise.resolve()));
  const session = createSession();
  await session.prepareAsync();
  session.startRemainingDevices();
  let claimed = false;
  const claiming = session
    .claimAsync({ engine: 'serve-sim', requestedDevice: 'iPhone 18' })
    .then(value => {
      claimed = true;
      return value;
    });
  try {
    await new Promise(resolve => setImmediate(resolve));
    expect(claimed).toBe(false);
    ready.resolve();
    expect((await claiming).device.port).toBe(3202);
    await session.stopAsync();
  } finally {
    ready.resolve();
  }
});

it.each(['agent-device'] as const)(
  'moves %s to the secondary only after the old tools stop',
  async engine => {
    configureTwoDevices();
    const oldStop = deferred<void>();
    let stoppingOld = true;
    jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async server => {
      if (server === agent && stoppingOld) {
        stoppingOld = false;
        await oldStop.promise;
      }
    });
    const session = createSession();
    await session.prepareAsync();
    session.startRemainingDevices();
    await until(() => jest.mocked(startServeSim).mock.calls.length === 2);
    const before = started(engine === 'agent-device' ? 'prepare' : 'server').length;
    const claiming = session.claimAsync({ engine, requestedDevice: 'PHONE18' });
    try {
      await new Promise(resolve => setImmediate(resolve));
      expect(started(engine === 'agent-device' ? 'prepare' : 'server')).toHaveLength(before);
      oldStop.resolve();
      expect((await claiming).device.udid).toBe('PHONE18');
      expect(started(engine === 'agent-device' ? 'prepare' : 'server')).toHaveLength(before + 1);
      if (engine === 'agent-device') {
        expect(started('prepare').at(-1)![1]).toContain('PHONE18');
      }
      await session.stopAsync();
    } finally {
      oldStop.resolve();
    }
  }
);

it('boots an unlisted replacement while both old servers stop, and drains both old shutdowns later', async () => {
  const servers = configureTwoDevices();
  const releaseDuo = deferred<void>(),
    release18 = deferred<void>();
  const shutdownDuo = deferred<void>(),
    shutdown18 = deferred<void>();
  jest
    .mocked(terminateProcessGroupAsync)
    .mockImplementation(server =>
      server === servers.DUO ? releaseDuo.promise : release18.promise
    );
  jest
    .mocked(shutdownSimulatorAsync)
    .mockImplementation(udid =>
      udid === 'DUO'
        ? shutdownDuo.promise
        : udid === 'PHONE18'
          ? shutdown18.promise
          : Promise.resolve()
    );
  const session = createSession();
  await session.prepareAsync();
  session.startRemainingDevices();
  await until(() => jest.mocked(startServeSim).mock.calls.length === 2);
  const claiming = session.claimAsync({ engine: 'serve-sim', requestedDevice: 'OTHER' });
  try {
    await until(() => ran('bootstatus', 'OTHER').length === 1);
    expect(terminateProcessGroupAsync).toHaveBeenCalledWith(servers.DUO);
    expect(terminateProcessGroupAsync).toHaveBeenCalledWith(servers.PHONE18);
    expect(startServeSim).toHaveBeenCalledTimes(2);
    releaseDuo.resolve();
    await new Promise(resolve => setImmediate(resolve));
    expect(startServeSim).toHaveBeenCalledTimes(2);
    release18.resolve();
    expect((await claiming).device).toEqual({ udid: 'OTHER', name: 'iPhone Other', port: 3200 });
    expect(startExpoGoPreinstall).toHaveBeenCalledTimes(2);
    let stopped = false;
    const stopping = session.stopAsync().then(() => {
      stopped = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    shutdownDuo.resolve();
    shutdown18.resolve();
    await stopping;
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('OTHER');
  } finally {
    releaseDuo.resolve();
    release18.resolve();
    shutdownDuo.resolve();
    shutdown18.resolve();
  }
});

it('reuses Argent on a secondary device while unused agent-device stops in the background', async () => {
  configureTwoDevices();
  const oldStop = deferred<void>();
  jest
    .mocked(stopProcessAndDescendantsAsync)
    .mockImplementation(server => (server === agent ? oldStop.promise : Promise.resolve()));
  const session = createSession();
  await session.prepareAsync();
  session.startRemainingDevices();
  await until(
    () => started('server').length === 1 && jest.mocked(startServeSim).mock.calls.length === 2
  );
  try {
    expect(
      (await session.claimAsync({ engine: 'argent', requestedDevice: 'PHONE18' })).device.port
    ).toBe(3202);
    expect(started('server')).toHaveLength(1);
    expect(stopProcessAndDescendantsAsync).not.toHaveBeenCalledWith(argent);
    expect(shutdownSimulatorAsync).not.toHaveBeenCalledWith('DUO');
    oldStop.resolve();
    await session.stopAsync();
  } finally {
    oldStop.resolve();
  }
});

it('stops partial device startup without requiring the parent signal to abort first', async () => {
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation((file, args, signal) => {
    if (args.includes('bootstatus')) {
      return new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      );
    }
    return original(file, args, signal);
  });
  const session = createSession();
  const preparing = session.prepareAsync().catch(error => error);
  await until(() => ran('bootstatus').length === 1);
  await session.stopAsync();
  expect(await preparing).toMatchObject({ name: 'AbortError' });
  expect(controller.signal.aborted).toBe(false);
  expect(startServeSim).not.toHaveBeenCalled();
  expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE');
});

it('a secondary startup paused before claim cannot create a late Expo Go install', async () => {
  configureTwoDevices();
  const release = deferred<void>();
  let checks = 0;
  const session = createWarmSimulatorSession({
    signal: controller.signal,
    onPreparationFailure,
    onBackgroundFailure,
    throwIfStoppingAsync: async () => {
      if (++checks === 2) {
        await release.promise;
      }
      controller.signal.throwIfAborted();
    },
  });
  await session.prepareAsync();
  session.startRemainingDevices();
  const claiming = session.claimAsync({ engine: 'serve-sim', requestedDevice: 'PHONE18' });
  try {
    expect(startExpoGoPreinstall).toHaveBeenCalledTimes(1);
    release.resolve();
    expect((await claiming).device.udid).toBe('PHONE18');
    expect(startExpoGoPreinstall).toHaveBeenCalledTimes(1);
    await session.stopAsync();
  } finally {
    release.resolve();
  }
});

it('does not shut down an unused secondary whose boot never started', async () => {
  configureTwoDevices();
  const release = deferred<void>();
  let checks = 0;
  const session = createWarmSimulatorSession({
    signal: controller.signal,
    onPreparationFailure,
    onBackgroundFailure,
    throwIfStoppingAsync: async () => {
      if (++checks === 2) {
        await release.promise;
      }
      controller.signal.throwIfAborted();
    },
  });
  await session.prepareAsync();
  session.startRemainingDevices();
  try {
    expect((await session.claimAsync({ engine: 'serve-sim' })).device.udid).toBe('DUO');
    release.resolve();
    await session.stopAsync();
    expect(ran('bootstatus', 'PHONE18')).toHaveLength(0);
    expect(shutdownSimulatorAsync).not.toHaveBeenCalledWith('PHONE18');
  } finally {
    release.resolve();
  }
});

it('does not cancel a retained Argent configuration when the default device retires', async () => {
  configureTwoDevices();
  const configured = deferred<string>();
  let configSignal: AbortSignal | undefined;
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation((file, args, signal) => {
    if (args.includes('artifacts-list-endpoint')) {
      configSignal = signal;
      return configured.promise;
    }
    return original(file, args, signal);
  });
  const session = createSession();
  await session.prepareAsync();
  session.startRemainingDevices();
  const claiming = session.claimAsync({ engine: 'argent', requestedDevice: 'PHONE18' });
  try {
    await until(() => jest.mocked(terminateProcessGroupAsync).mock.calls.length > 0);
    expect(configSignal?.aborted).toBe(false);
    expect(onPreparationFailure).not.toHaveBeenCalled();
    configured.resolve('');
    expect((await claiming).device.udid).toBe('PHONE18');
    expect(started('server')).toHaveLength(1);
    await session.stopAsync();
  } finally {
    configured.resolve('');
  }
});

it('rejects an ambiguous warm name even when both exact UDIDs were configured', async () => {
  process.env.EXPO_SIMULATOR_DEVICE = 'PHONE,OTHER';
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation((file, args, signal) =>
    args.includes('devices')
      ? Promise.resolve(
          JSON.stringify({
            devices: {
              ios: [
                { udid: 'PHONE', name: 'iPhone Same' },
                { udid: 'OTHER', name: 'iPhone Same' },
              ],
            },
          })
        )
      : original(file, args, signal)
  );
  const session = createSession();
  await session.prepareAsync();
  session.startRemainingDevices();
  await expect(
    session.claimAsync({ engine: 'serve-sim', requestedDevice: 'iPhone Same' })
  ).rejects.toThrow('More than one');
  await session.stopAsync();
});

it('returns only the selected device preinstall metadata', async () => {
  configureTwoDevices();
  jest.mocked(startExpoGoPreinstall).mockImplementation(udid => ({
    resultPromise: Promise.resolve(),
    stopAsync: jest.fn(async () => {}),
    claimAsync: jest.fn(async () => ({
      udid,
      bundleIdentifier: 'host.exp.Exponent',
      shortVersion: udid === 'DUO' ? '58.0.5' : '58.0.6',
      version: '1',
    })),
  }));
  const session = createSession();
  await session.prepareAsync();
  session.startRemainingDevices();
  await until(() => jest.mocked(startExpoGoPreinstall).mock.calls.length === 2);
  const result = await session.claimAsync({ engine: 'serve-sim', requestedDevice: 'PHONE18' });
  expect(result.preinstalledExpoGo).toEqual({
    udid: 'PHONE18',
    bundleIdentifier: 'host.exp.Exponent',
    shortVersion: '58.0.6',
    version: '1',
  });
  await session.stopAsync();
});
