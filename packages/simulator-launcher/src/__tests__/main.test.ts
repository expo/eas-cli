import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { claimAsync, prepareToolsAsync } from '../commands/claim';
import * as prefetch from '../commands/prefetch';
import { runWarmSimulatorSessionAsync, startAsync } from '../commands/start';
import { stopAsync } from '../commands/stop';
import { mainAsync } from '../main';
import { createArgentTool } from '../utils/argent';
import { startExpoGoPreinstall } from '../utils/expoGo';
import { type ChildProcessHandle, commands } from '../utils/processes';
import * as processes from '../utils/processes';
import * as serveSim from '../utils/serveSim';
import { shutdownSimulatorAsync } from '../utils/simulator';
import {
  LAUNCHER_STATE_FILE,
  readLauncherStateAsync,
  updateLauncherStateAsync,
  waitForLauncherStateAsync,
} from '../utils/state';
import { deferred, until } from './helpers';

jest.mock('../utils/expoGo');
jest.mock('../utils/argent');
const boot = 'boot-one';
let root: string;
let environment: NodeJS.ProcessEnv;
let active: Promise<unknown>[];
let jobs: ChildProcessHandle[];
const platform = process.platform;
const deviceList = {
  devices: {
    ios: [
      { name: 'iPhone 17', udid: 'PHONE' },
      { name: 'iPhone 17 Pro', udid: 'PRO' },
    ],
  },
};

const nativeFs = {
  readFile: fs.readFile.bind(fs),
  writeFile: fs.writeFile.bind(fs),
  rename: fs.rename.bind(fs),
  rm: fs.rm.bind(fs),
  mkdir: fs.mkdir.bind(fs),
  rmdir: fs.rmdir.bind(fs),
  stat: fs.stat.bind(fs),
};
const remap = (file: unknown): unknown =>
  typeof file === 'string' && file.startsWith(LAUNCHER_STATE_FILE)
    ? path.join(root, 'control', path.basename(file))
    : file;

async function status(value: string) {
  return await waitForLauncherStateAsync(boot, state => state?.status === value, 2_000);
}
async function beginSession(): Promise<Promise<unknown>[]> {
  await updateLauncherStateAsync(boot, () => ({
    bootUuid: boot,
    status: 'starting',
    launcherVersion: require('../../package.json').version,
    controllerPid: process.pid,
  }));
  const completion = runWarmSimulatorSessionAsync(boot).catch(error => error);
  active.push(completion);
  return [completion];
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-session-'));
  jest.spyOn(os, 'homedir').mockReturnValue(root);
  await fs.mkdir(path.join(root, 'control'));
  await fs.mkdir(path.join(root, '.argent'));
  await fs.writeFile(
    path.join(root, '.argent/tool-server.json'),
    JSON.stringify({ pid: 90002, port: 3201, token: 'fixture-token' })
  );
  jest.spyOn(processes, 'isProcessOwnedByServiceAsync').mockResolvedValue(true);
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify({ tools: [] })));
  for (const name of ['readFile', 'writeFile', 'rename', 'rm', 'mkdir', 'rmdir', 'stat'] as const) {
    jest.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
      args[0] = remap(args[0]);
      if (name === 'rename') {
        args[1] = remap(args[1]);
      }
      return (nativeFs[name] as (...args: unknown[]) => unknown)(...args);
    }) as never);
  }

  Object.defineProperty(process, 'platform', { value: 'darwin' });
  environment = { ...process.env };
  process.env.EXPO_SIMULATOR_STARTUP = '1';
  process.env.ARGENT_EVENT_LOG = path.join(root, 'argent-events');
  active = [];
  jobs = [];
  jest
    .mocked(startExpoGoPreinstall)
    .mockReset()
    .mockReturnValue({
      preinstallOnDeviceAsync: jest.fn(async () => {}),
      claimAsync: jest.fn(async () => undefined),
      stopAsync: jest.fn(async () => {}),
    });
  jest.spyOn(commands, 'runAsync').mockImplementation(async (file, args) => {
    if (file === '/usr/sbin/sysctl') {
      return boot;
    }
    if (args.includes('lstart=')) {
      return 'Thu Oct 22 10:00:00 2026';
    }
    if (args.includes('devices')) {
      return JSON.stringify(deviceList);
    }
    if (args.includes('launchctl') && args.includes('list')) {
      throw Object.assign(new Error('apsd is not loaded'), { code: 113 });
    }
    return '';
  });
  jest.spyOn(commands, 'start').mockImplementation((_file, args) => {
    const job = {
      child: Object.assign(new EventEmitter(), {
        pid: 90000 + jobs.length,
        exitCode: null,
        signalCode: null,
        kill: jest.fn(),
      }) as unknown as ChildProcess,
      resultPromise: args.includes('server') ? new Promise<string>(() => {}) : Promise.resolve(''),
    };
    jobs.push(job);
    return job;
  });
  // Fixture PIDs are fake; never signal them.
  jest.spyOn(processes, 'stopProcessAndDescendantsAsync').mockResolvedValue();
  jest.spyOn(serveSim, 'waitForServeSimReadyAsync').mockResolvedValue({
    startupDevice: 'PHONE',
    pid: 90000,
    nativeStartTime: 'native-start',
    port: 3200,
    url: 'http://127.0.0.1:3200',
    token: 'fixture-token',
  });
  jest.mocked(createArgentTool).mockImplementation(() => ({
    name: 'argent',
    startAsync: async () => {},
    stopAsync: async () => {},
  }));
});
afterEach(async () => {
  if (active.length) {
    process.emit('SIGTERM', 'SIGTERM');
  }
  await Promise.allSettled(active);
  jest.restoreAllMocks();
  process.env = environment;
  Object.defineProperty(process, 'platform', { value: platform });
  await fs.rm(root, { recursive: true, force: true });
});

test('warmup is finite, never claimable, and joins cleanup before returning', async () => {
  const prefetching = deferred<number>();
  jest.spyOn(prefetch, 'prefetchAsync').mockReturnValue(prefetching.promise);
  process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO = '0';
  const drain = deferred();
  jest.spyOn(processes, 'stopProcessAndDescendantsAsync').mockReturnValue(drain.promise);
  let done = false;
  const completion = mainAsync(['warmup']).then(value => {
    done = true;
    return value;
  });
  active.push(completion);
  try {
    await status('starting');
    expect(commands.start).not.toHaveBeenCalled();
    prefetching.resolve(0);
    await status('stopping');
    expect(done).toBe(false);
    expect(await readLauncherStateAsync(boot)).not.toHaveProperty('server');
    drain.resolve();
    expect(await completion).toBe(0);
    expect(await readLauncherStateAsync(boot)).toMatchObject({ status: 'disabled' });
    await expect(mainAsync(['warmup'])).rejects.toThrow('fresh boot');
  } finally {
    prefetching.resolve(0);
    drain.resolve();
  }
});

test('interrupted prefetch fails after cleanup instead of reporting success', async () => {
  jest.spyOn(prefetch, 'prefetchAsync').mockImplementation(
    signal =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      })
  );
  const completion = mainAsync(['warmup']).catch(error => error);
  active.push(completion);
  await status('starting');
  process.emit('SIGTERM', 'SIGTERM');
  expect(await completion).toBeInstanceOf(Error);
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'disabled',
    error: expect.any(String),
  });
  expect(commands.start).not.toHaveBeenCalled();
});

test('prefetch failure propagates without starting native preparation', async () => {
  jest.spyOn(prefetch, 'prefetchAsync').mockRejectedValue(new Error('download failed'));
  await expect(mainAsync(['warmup'])).rejects.toThrow('download failed');
  expect(commands.start).not.toHaveBeenCalled();
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'disabled',
    error: 'download failed',
  });
});

test('warmup rejects an active startup before prefetch can replace caches', async () => {
  const fetching = jest.spyOn(prefetch, 'prefetchAsync').mockResolvedValue(0);
  await updateLauncherStateAsync(boot, () => ({
    bootUuid: boot,
    status: 'starting',
    controllerPid: 123,
  }));
  await expect(mainAsync(['warmup'])).rejects.toThrow('already been started');
  expect(fetching).not.toHaveBeenCalled();
});

test('warmup cleanup failure remains visible and cannot report completion', async () => {
  jest.spyOn(prefetch, 'prefetchAsync').mockResolvedValue(0);
  process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO = '0';
  jest
    .spyOn(processes, 'stopProcessAndDescendantsAsync')
    .mockRejectedValue(new Error('still running'));
  await expect(mainAsync(['warmup'])).rejects.toThrow('cleanup could not be confirmed');
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'stopping',
    error: expect.any(String),
  });
});

test('warmup requires startup enabled before replacing cached files', async () => {
  delete process.env.EXPO_SIMULATOR_STARTUP;
  const fetching = jest.spyOn(prefetch, 'prefetchAsync').mockResolvedValue(0);
  await expect(mainAsync(['warmup'])).rejects.toThrow('requires EXPO_SIMULATOR_STARTUP=1');
  expect(fetching).not.toHaveBeenCalled();
});

test('warmup rejects extra arguments before native work', async () => {
  await expect(mainAsync(['warmup', 'extra'])).rejects.toThrow('Usage: simulator-launcher warmup');
  expect(commands.runAsync).not.toHaveBeenCalled();
});

test('tool preparation deadline fails the command and still joins cleanup', async () => {
  const deadline = new AbortController();
  const timeout = AbortSignal.timeout;
  jest
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation(ms => (ms === 600_000 ? deadline.signal : timeout(ms)));
  jest.spyOn(prefetch, 'prefetchAsync').mockResolvedValue(0);
  process.env.EXPO_SIMULATOR_PREINSTALL_EXPO_GO = '0';
  const entered = deferred();
  jest
    .mocked(serveSim.waitForServeSimReadyAsync)
    .mockImplementation(async (_udid, _server, signal) => {
      entered.resolve();
      return await new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      );
    });
  const completion = mainAsync(['warmup']).catch(error => error);
  active.push(completion);
  await entered.promise;
  deadline.abort(new Error('preparation deadline elapsed'));
  expect(await completion).toMatchObject({ message: 'preparation deadline elapsed' });
  expect(processes.stopProcessAndDescendantsAsync).toHaveBeenCalled();
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'disabled',
    error: 'preparation deadline elapsed',
  });
});

test('concurrent starts acquire one session and record the exact package version', async () => {
  process.env.SERVE_SIM_VERSION = '0.13.3';
  process.env.AGENT_DEVICE_VERSION = '0.16.0';
  process.env.ARGENT_VERSION = '1.0.0';
  const results: unknown[] = [];
  const starts = [0, 1].map(() =>
    startAsync(boot).then(
      value => results.push(value),
      error => results.push(error)
    )
  );
  active.push(...starts);
  await status('ready');
  await until(() => results.length === 1);
  expect(results[0]).toBeInstanceOf(Error);
  expect((await readLauncherStateAsync(boot))?.launcherVersion).toBe(
    require('../../package.json').version
  );
  expect((await readLauncherStateAsync(boot))?.serveSimVersion).toBe('0.13.3');
  expect(jest.mocked(serveSim.waitForServeSimReadyAsync).mock.calls).toHaveLength(1);
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  await claimAsync(boot, 'serve-sim');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({
    status: 'claimed',
    serveSimVersion: '0.13.3',
    agentDeviceVersion: '0.16.0',
    argentVersion: '1.0.0',
  });
  await stopAsync(boot);
  await Promise.all(starts);
  expect((await readLauncherStateAsync(boot))?.status).toBe('disabled');
});

test.each([undefined, 'latest', '^0.13'])(
  'start does not claim a resolved version for selector %s',
  async version => {
    if (version === undefined) {
      delete process.env.SERVE_SIM_VERSION;
    } else {
      process.env.SERVE_SIM_VERSION = version;
    }
    if (version === undefined) {
      delete process.env.AGENT_DEVICE_VERSION;
      delete process.env.ARGENT_VERSION;
    } else {
      process.env.AGENT_DEVICE_VERSION = version;
      process.env.ARGENT_VERSION = version;
    }
    const starting = startAsync(boot);
    active.push(starting);
    await status('ready');
    const state = await readLauncherStateAsync(boot);
    expect(state?.serveSimVersion).toBeUndefined();
    expect(state?.agentDeviceVersion).toBeUndefined();
    expect(state?.argentVersion).toBeUndefined();
    await stopAsync(boot);
    await starting;
  }
);

test('stop before start makes late startup a resource-free disabled no-op', async () => {
  expect(await stopAsync(boot)).toBe(0);
  expect(await startAsync(boot)).toBe(0);
  expect(commands.runAsync).not.toHaveBeenCalled();
  expect(commands.start).not.toHaveBeenCalled();
  expect(await readLauncherStateAsync(boot)).toEqual({ bootUuid: boot, status: 'disabled' });
});

test('stop under different HOME and TMPDIR waits for the same active session cleanup', async () => {
  const [completion] = await beginSession();
  await status('ready');
  const drain = deferred();
  jest.mocked(processes.stopProcessAndDescendantsAsync).mockImplementation(async () => {
    await drain.promise;
  });
  process.env.HOME = path.join(root, 'other-home');
  process.env.TMPDIR = path.join(root, 'other-tmp');
  jest.mocked(os.homedir).mockReturnValue(process.env.HOME);
  let done = false;
  const stopping = mainAsync(['stop']).then(value => {
    done = true;
    return value;
  });
  try {
    await status('stopping');
    expect(done).toBe(false);
    drain.resolve();
    expect(await stopping).toBe(0);
    expect(await completion).toBeUndefined();
    expect((await readLauncherStateAsync(boot))?.status).toBe('disabled');
  } finally {
    drain.resolve();
    await stopping;
  }
});

test('ready contains one server identity and effective paths in the single state file', async () => {
  const [completion] = await beginSession();
  const ready = await status('ready');
  expect(ready).toMatchObject({
    controllerPid: process.pid,
    device: { udid: 'PHONE' },
    server: { startupDevice: 'PHONE', pid: 90000, nativeStartTime: 'native-start', port: 3200 },
  });
  expect(ready?.agentDeviceStateDir).toContain(root);
  expect(await fs.readdir(path.join(root, 'control'))).toEqual([
    path.basename(LAUNCHER_STATE_FILE),
  ]);
  await stopAsync(boot);
  expect(await completion).toBeUndefined();
});

test.each([undefined, 'phone', 'iPhone 17 Pro'])(
  'claim reserves %s without changing the server or booting devices',
  async selector => {
    const [completion] = await beginSession();
    await status('ready');
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    await claimAsync(boot, 'serve-sim', selector);
    const result = JSON.parse(String(output.mock.calls.at(-1)![0]));
    expect(result).toMatchObject({
      status: 'claimed',
      engine: 'serve-sim',
      device: { udid: selector === 'iPhone 17 Pro' ? 'PRO' : 'PHONE' },
      server: { startupDevice: 'PHONE', port: 3200, pid: 90000 },
    });
    expect(result.device).not.toHaveProperty('port');
    expect(
      jest.mocked(commands.runAsync).mock.calls.filter(([, args]) => args.includes('bootstatus'))
    ).toHaveLength(0);
    await expect(claimAsync(boot, 'argent')).rejects.toThrow('available');
    await stopAsync(boot);
    expect(await completion).toBeUndefined();
  }
);

test.each([
  [undefined, undefined],
  ['invalid', undefined],
  ['serve-sim', ' '],
])('invalid claim %s/%s does not acquire or mutate state', async (engine, device) => {
  const [completion] = await beginSession();
  await status('ready');
  const before = await readLauncherStateAsync(boot);
  await expect(claimAsync(boot, engine, device)).rejects.toThrow(
    'Invalid Simulator session request'
  );
  expect(await readLauncherStateAsync(boot)).toEqual(before);
  await stopAsync(boot);
  await completion;
});

test('the post-adopt preparation command uses the consumed claim and returns toolsReady', async () => {
  const [completion] = await beginSession();
  await status('ready');
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  await expect(prepareToolsAsync(boot)).rejects.toThrow('Claim and adopt');
  await claimAsync(boot, 'agent-device');
  expect((await readLauncherStateAsync(boot))?.toolsReady).toBeUndefined();
  await prepareToolsAsync(boot);
  expect(JSON.parse(String(output.mock.calls.at(-1)![0]))).toMatchObject({
    status: 'claimed',
    engine: 'agent-device',
    toolsReady: true,
    prepareToolsRequested: true,
  });
  await stopAsync(boot);
  expect(await completion).toBeUndefined();
});

test('prepare-tools returns the validated Argent identity past an earlier stale same-port record', async () => {
  jest
    .mocked(createArgentTool)
    .mockImplementation(jest.requireActual('../utils/argent').createArgentTool);
  await fs.writeFile(
    path.join(root, '.argent/tool-server-old.json'),
    JSON.stringify({ pid: 90099, port: 3201, token: 'stale-token' })
  );
  jest
    .spyOn(fs, 'readdir')
    .mockResolvedValue(['tool-server-old.json', 'tool-server.json'] as never);
  jest
    .mocked(processes.isProcessOwnedByServiceAsync)
    .mockImplementation(async pid => pid !== 90099);
  const [completion] = await beginSession();
  await status('ready');
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  await claimAsync(boot, 'argent');
  await prepareToolsAsync(boot);
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({
    toolsReady: true,
    tools: { pid: 90002, port: 3201, token: 'fixture-token' },
  });
  expect(fetch).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ headers: { Authorization: 'Bearer stale-token' } })
  );
  await stopAsync(boot);
  expect(await completion).toBeUndefined();
});

test('stop during post-adopt preparation prevents toolsReady and waits for owned drain', async () => {
  const [completion] = await beginSession();
  await status('ready');
  jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  await claimAsync(boot, 'appium');
  const entered = deferred();
  const release = deferred();
  let preparationSignal: AbortSignal;
  jest
    .mocked(serveSim.waitForServeSimReadyAsync)
    .mockImplementationOnce(async (_device, _server, signal) => {
      preparationSignal = signal;
      entered.resolve();
      await release.promise;
      signal.throwIfAborted();
      throw new Error('unreachable');
    });
  const preparing = prepareToolsAsync(boot).catch(error => error);
  try {
    await entered.promise;
    const stopping = stopAsync(boot);
    await status('stopping');
    await until(() => preparationSignal.aborted);
    release.resolve();
    await stopping;
    expect(await preparing).toBeInstanceOf(Error);
    expect((await readLauncherStateAsync(boot))?.toolsReady).not.toBe(true);
    expect(await completion).toBeUndefined();
  } finally {
    release.resolve();
  }
});

test('claim does not wait for the Expo Go install; prepare-tools does, and stop drains cleanup', async () => {
  const info = {
    udid: 'PHONE',
    bundleIdentifier: 'host.exp.Exponent',
    shortVersion: '58.0.7',
    version: '58.0.7',
  };
  const install = deferred<typeof info>();
  const cleanup = deferred();
  jest.mocked(startExpoGoPreinstall).mockReturnValue({
    // The default device's preinstall stays open until its cleanup finishes.
    preinstallOnDeviceAsync: jest.fn(() => cleanup.promise),
    claimAsync: jest.fn(() => install.promise),
    stopAsync: jest.fn(() => cleanup.promise),
  });
  const [completion] = await beginSession();
  await status('ready');
  jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    await claimAsync(boot, 'serve-sim');
    expect(await readLauncherStateAsync(boot)).not.toHaveProperty('preinstalledExpoGo');
    let prepared = false;
    const preparing = prepareToolsAsync(boot).then(() => {
      prepared = true;
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(prepared).toBe(false);
    install.resolve(info);
    await preparing;
    expect(await readLauncherStateAsync(boot)).toMatchObject({
      toolsReady: true,
      preinstalledExpoGo: info,
    });
    const stopping = stopAsync(boot);
    await status('stopping');
    expect((await readLauncherStateAsync(boot))?.status).not.toBe('disabled');
    cleanup.resolve();
    await stopping;
    await completion;
  } finally {
    install.resolve(info);
    cleanup.resolve();
  }
});

test('preparation failure confirms cleanup before publishing disabled with its cause', async () => {
  jest
    .mocked(serveSim.waitForServeSimReadyAsync)
    .mockRejectedValueOnce(new Error('native readiness failed'));
  const [completion] = await beginSession();
  expect(((await completion) as Error).message).toBe('native readiness failed');
  expect(processes.stopProcessAndDescendantsAsync).toHaveBeenCalled();
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'disabled',
    error: 'native readiness failed',
  });
});

test('cleanup failure leaves stopping with a cause and never publishes disabled', async () => {
  const [completion] = await beginSession();
  await status('ready');
  jest
    .mocked(processes.stopProcessAndDescendantsAsync)
    .mockRejectedValue(new Error('child not drained'));
  process.emit('SIGTERM', 'SIGTERM');
  expect(await completion).toBeInstanceOf(AggregateError);
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'stopping',
    error: expect.stringContaining('cleanup could not be confirmed'),
  });
});

test('stop waits on a versionless active state', async () => {
  await updateLauncherStateAsync(boot, () => ({
    bootUuid: boot,
    status: 'ready',
    controllerPid: 9000,
  }));
  const stopping = stopAsync(boot);
  await status('stopping');
  await updateLauncherStateAsync(boot, state => ({ ...state!, status: 'disabled' }));
  expect(await stopping).toBe(0);
});

test('--version prints the exact package version without touching boot or state', async () => {
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  expect(await mainAsync(['--version'])).toBe(0);
  expect(output).toHaveBeenCalledWith(`${require('../../package.json').version}\n`);
  expect(commands.runAsync).not.toHaveBeenCalled();
});

test.each(['install', 'adopt', 'run'])('rejects removed command %s', async command => {
  await expect(mainAsync([command])).rejects.toThrow('Usage:');
  expect(commands.runAsync).not.toHaveBeenCalled();
});
test.each(['linux', 'win32'])('rejects %s before state or native work', async target => {
  Object.defineProperty(process, 'platform', { value: target });
  await expect(mainAsync(['start'])).rejects.toThrow('requires macOS');
  expect(await fs.readdir(path.join(root, 'control'))).toEqual([]);
});

test.each([
  ['Shutdown', true],
  ['Booted', false],
])('native shutdown error for %s is confirmed done: %s', async (state, done) => {
  const failure = new Error('shutdown failed');
  jest.mocked(commands.runAsync).mockImplementation(async (_file, args) => {
    if (args.includes('shutdown')) {
      throw failure;
    }
    return JSON.stringify({ devices: { ios: [{ udid: 'OLD', state }] } });
  });
  const result = shutdownSimulatorAsync('OLD');
  if (done) {
    await expect(result).resolves.toBeUndefined();
  } else {
    await expect(result).rejects.toBe(failure);
  }
});

test('start uses supplied runtime versions, ignores legacy pins and claims one boot snapshot', async () => {
  for (const name of [
    'SERVE_SIM_VERSION',
    'AGENT_DEVICE_VERSION',
    'ARGENT_VERSION',
    'EXPO_GO_SDK_VERSION',
  ]) {
    delete process.env[name];
  }
  process.env.SERVE_SIM_VERSION = '0.13.3';
  process.env.AGENT_DEVICE_VERSION = '0.21.36';
  process.env.ARGENT_VERSION = '0.32.0';
  const queries = jest.spyOn(commands, 'runOwnedAsync');
  const file = path.join(root, 'Library/Caches/expo-simulator-startup/prepared.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const expoGo = { sdk: '58.0.0', url: 'https://example.test/prepared-expo-go.tar.gz' };
  await fs.writeFile(
    file,
    JSON.stringify({
      tools: {
        'serve-sim': { version: '0.1.0' },
        'agent-device': { version: 'invalid legacy pin' },
        argent: { version: '0.32.0' },
        'expo-go': expoGo,
      },
    })
  );
  const starting = startAsync(boot);
  active.push(starting);
  await status('ready');
  expect(commands.start).toHaveBeenCalledWith(
    'bunx',
    expect.arrayContaining(['@expo/serve-sim@0.13.3']),
    expect.anything()
  );
  expect(commands.start).toHaveBeenCalledWith(
    'bunx',
    expect.arrayContaining(['agent-device@0.21.36']),
    expect.anything()
  );
  expect(startExpoGoPreinstall).toHaveBeenCalledWith(expect.any(AbortSignal), expoGo, false);
  await fs.writeFile(file, JSON.stringify({ tools: { 'serve-sim': { version: '0.13.4' } } }));
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  await claimAsync(boot, 'serve-sim');
  expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({
    serveSimVersion: '0.13.3',
    agentDeviceVersion: '0.21.36',
    argentVersion: '0.32.0',
  });
  expect(queries).not.toHaveBeenCalled();
  await stopAsync(boot);
  await starting;
});

test('start honors a supplied Expo Go SDK over an older prepared selection', async () => {
  process.env.EXPO_GO_SDK_VERSION = '59.0.0';
  const file = path.join(root, 'Library/Caches/expo-simulator-startup/prepared.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      tools: {
        'expo-go': { sdk: '58.0.0', url: 'https://example.test/older-expo-go.tar.gz' },
      },
    })
  );
  const starting = startAsync(boot);
  active.push(starting);
  await status('ready');
  expect(startExpoGoPreinstall).toHaveBeenCalledWith(expect.any(AbortSignal), undefined, false);
  expect(process.env.EXPO_GO_SDK_VERSION).toBe('59.0.0');
  await stopAsync(boot);
  await starting;
});

test('invalid legacy CLI metadata does not prevent runtime startup', async () => {
  const file = path.join(root, 'Library/Caches/expo-simulator-startup/prepared.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ tools: { 'serve-sim': { version: 'latest' } } }));
  const starting = startAsync(boot);
  active.push(starting);
  await status('ready');
  expect(commands.start).toHaveBeenCalled();
  await stopAsync(boot);
  await starting;
});

test('warmup refreshes archive metadata while runtime overrides ignore legacy CLI pins', async () => {
  jest.mocked(startExpoGoPreinstall).mockReturnValue({
    preinstallOnDeviceAsync: jest.fn(async () => {}),
    claimAsync: jest.fn(async udid => ({
      udid,
      bundleIdentifier: 'host.exp.Exponent',
      shortVersion: '58.0.7',
      version: '1',
    })),
    stopAsync: jest.fn(async () => {}),
  });
  const file = path.join(root, 'Library/Caches/expo-simulator-startup/prepared.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ tools: { 'serve-sim': { version: '0.13.3' } } }));
  process.env.SERVE_SIM_VERSION = '0.13.4';
  const fetching = jest.spyOn(prefetch, 'prefetchAsync').mockImplementation(async () => {
    expect(process.env.SERVE_SIM_VERSION).toBe('0.13.4');
    await fs.writeFile(
      file,
      JSON.stringify({
        tools: {
          'serve-sim': { version: '0.1.0' },
          'expo-go': { sdk: '58.0.0', url: 'https://example.test/prepared-expo-go.tar.gz' },
        },
      })
    );
    return 0;
  });
  expect(await mainAsync(['warmup'])).toBe(0);
  expect(fetching).toHaveBeenCalledTimes(1);
  expect(commands.start).toHaveBeenCalledWith(
    'bunx',
    expect.arrayContaining(['@expo/serve-sim@0.13.4']),
    expect.anything()
  );
  expect(startExpoGoPreinstall).toHaveBeenCalledWith(
    expect.any(AbortSignal),
    { sdk: '58.0.0', url: 'https://example.test/prepared-expo-go.tar.gz' },
    true
  );
  expect((await readLauncherStateAsync(boot))?.status).toBe('disabled');
});
