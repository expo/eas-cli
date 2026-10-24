import { type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createWarmSimulatorSession } from '../commands/start';
import { stopServicesAndShutdownSimulatorAsync } from '../commands/stop';
import { startAgentDevicePreparation, stopAgentDeviceDaemonAsync } from '../utils/agentDevice';
import { prepareArgentEnvironmentAsync, startArgentServer } from '../utils/argent';
import { startExpoGoPreinstall } from '../utils/expoGo';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
} from '../utils/processes';
import { startServeSim } from '../utils/serveSim';

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
  jest
    .mocked(commands.runAsync)
    .mockImplementation(async (_file, args) =>
      args.includes('list')
        ? JSON.stringify({ devices: { ios: [{ udid: 'PHONE', name: 'iPhone 17' }] } })
        : 'native-start-time'
    );
  jest.mocked(startServeSim).mockReturnValue(serveSim);
  jest.mocked(startAgentDevicePreparation).mockReturnValue(agent);
  jest.mocked(startArgentServer).mockReturnValue(argent);
  jest.mocked(startExpoGoPreinstall).mockReturnValue({
    claimAsync: jest.fn(async () => {}),
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
      'PHONE',
      agent
    );
    expect(startArgentServer).not.toHaveBeenCalled();
  } finally {
    argentPreparation.reject(failure);
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
      udid: 'PHONE',
      name: 'iPhone 17',
    });
    await until(() => jest.mocked(stopAgentDeviceDaemonAsync).mock.calls.length > 0);
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(prepare, true);
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(argent);
    expect(onPreparationFailure).not.toHaveBeenCalled();
    await session.stopAsync();
    expect(stopServicesAndShutdownSimulatorAsync).toHaveBeenCalledWith(
      new Set([serveSim]),
      'PHONE',
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
    expect(await claiming).toMatchObject({ udid: 'PHONE' });
    expect(startArgentServer).toHaveBeenCalledTimes(1);
    expect(onPreparationFailure).not.toHaveBeenCalled();
  } finally {
    preparing.reject(new Error('stopped'));
    argentConfig.resolve();
  }
});

it('replacement boots the new device while the old one is released, then starts only the requested tool', async () => {
  const release = deferred<void>();
  jest.mocked(commands.runAsync).mockImplementation(async (_file, args) =>
    args.includes('list')
      ? JSON.stringify({
          devices: {
            ios: [
              { udid: 'PHONE', name: 'iPhone 17' },
              { udid: 'PRO', name: 'iPhone 17 Pro' },
            ],
          },
        })
      : 'native-start-time'
  );
  jest.mocked(stopServicesAndShutdownSimulatorAsync).mockReturnValueOnce(release.promise);
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
    expect(stopServicesAndShutdownSimulatorAsync).toHaveBeenCalledWith(
      expect.any(Set),
      'PHONE',
      undefined
    );
    expect(startServeSim).not.toHaveBeenCalled();
    expect(startAgentDevicePreparation).not.toHaveBeenCalled();
    release.resolve();
    expect(await claiming).toEqual({ udid: 'PRO', name: 'iPhone 17 Pro' });
    expect(startServeSim).toHaveBeenCalledWith('PRO', controller.signal);
    expect(startAgentDevicePreparation).toHaveBeenCalledWith('PRO', expect.anything());
    expect(startArgentServer).not.toHaveBeenCalled();
  } finally {
    release.resolve();
  }
});

it('drains unused tools and the whole Expo Go task before native cleanup, retaining their failure', async () => {
  const unusedAgent = deferred<void>();
  const unusedArgent = deferred<void>();
  const expoCleanup = deferred();
  const failure = new Error('Argent stop failed');
  const preinstall = {
    claimAsync: jest.fn(async () => {}),
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
    udid: 'PHONE',
    name: 'iPhone 17',
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
      'PHONE',
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
        headers: { Authorization: 'Bearer secret' },
        signal: expect.any(AbortSignal),
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(tmpdir, { recursive: true, force: true });
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
