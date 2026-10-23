import { type ChildProcess } from 'node:child_process';
import os from 'node:os';

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

it('creates an idle owner synchronously and stops services acquired before preparation fails', async () => {
  const argentPreparation = deferred();
  const failure = new Error('Argent preparation failed');
  jest.mocked(prepareArgentEnvironmentAsync).mockReturnValueOnce(argentPreparation.promise);
  const session = createSession();
  expect(commands.runAsync).not.toHaveBeenCalled();
  const preparing = session.prepareAsync();
  const rejected = expect(preparing).rejects.toBe(failure);
  try {
    await until(() => jest.mocked(startAgentDevicePreparation).mock.calls.length > 0);
    argentPreparation.reject(failure);
    await rejected;
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
    await preparing.catch(() => {});
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
  jest.mocked(stopProcessAndDescendantsAsync).mockReturnValueOnce(unusedArgent.promise);
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
      new Set([serveSim, agent, argent]),
      'PHONE',
      agent
    );
  } finally {
    unusedArgent.reject(failure);
    unusedAgent.resolve();
    expoCleanup.resolve();
    await stopping.catch(() => {});
  }
});
