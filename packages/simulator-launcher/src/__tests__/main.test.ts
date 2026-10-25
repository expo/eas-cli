import { type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { claimAsync } from '../commands/claim';
import { runWarmSimulatorSessionAsync, startAsync } from '../commands/start';
import { stopAsync } from '../commands/stop';
import { mainAsync } from '../main';
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
  active = [];
  jobs = [];
  jest
    .mocked(startExpoGoPreinstall)
    .mockReset()
    .mockReturnValue({
      resultPromise: Promise.resolve(),
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
  jest.spyOn(commands, 'start').mockImplementation(() => {
    const job = {
      child: {
        pid: 90000 + jobs.length,
        exitCode: null,
        signalCode: null,
        kill: jest.fn(),
      } as unknown as ChildProcess,
      resultPromise: Promise.resolve(''),
    };
    jobs.push(job);
    return job;
  });
  jest.spyOn(processes, 'stopProcessAndDescendantsAsync').mockResolvedValue();
  // Fixture PIDs are fake; never signal them.
  jest.spyOn(processes, 'terminateProcessGroupAsync').mockResolvedValue();
  jest.spyOn(serveSim, 'waitForServeSimReadyAsync').mockResolvedValue();
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

test('concurrent starts acquire one session and pin only the winning bundle', async () => {
  const copy = jest.spyOn(fs, 'copyFile');
  const results: unknown[] = [];
  const starts = [0, 1].map(() =>
    startAsync(boot, require.resolve('../main')).then(
      value => results.push(value),
      error => results.push(error)
    )
  );
  active.push(...starts);
  await status('ready');
  await until(() => results.length === 1);
  expect(results[0]).toBeInstanceOf(Error);
  expect(copy).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(path.join(root, '.expo/simulator-tools/run'), 'utf8')).toContain(
    'runCliAsync'
  );
  expect(jobs).toHaveLength(3);
  await stopAsync(boot);
  await Promise.all(starts);
  expect((await readLauncherStateAsync(boot))?.status).toBe('disabled');
});

test('stop before download makes every later start a resource-free disabled no-op', async () => {
  expect(await stopAsync(boot)).toBe(0);
  const copy = jest.spyOn(fs, 'copyFile');
  expect(await startAsync(boot, 'not-downloaded')).toBe(0);
  expect(copy).not.toHaveBeenCalled();
  expect(commands.runAsync).not.toHaveBeenCalled();
  expect(commands.start).not.toHaveBeenCalled();
  expect(await readLauncherStateAsync(boot)).toEqual({ bootUuid: boot, status: 'disabled' });
});

test('package stop under a different HOME and TMPDIR still waits for the active session cleanup', async () => {
  const [completion] = await beginSession();
  await status('ready');
  const drain = deferred<void>();
  jest.mocked(processes.stopProcessAndDescendantsAsync).mockImplementation(async () => {
    await drain.promise;
  });
  const otherHome = path.join(root, 'different-home');
  process.env.HOME = otherHome;
  process.env.TMPDIR = path.join(root, 'different-tmp');
  jest.mocked(os.homedir).mockReturnValue(otherHome);
  let finished = false;
  const stopping = mainAsync(['stop']).then(value => {
    finished = true;
    return value;
  });
  try {
    await status('stopping');
    expect(finished).toBe(false);
    expect((await readLauncherStateAsync(boot))?.status).toBe('stopping');
    drain.resolve();
    expect(await stopping).toBe(0);
    expect(await completion).toBeUndefined();
    expect((await readLauncherStateAsync(boot))?.status).toBe('disabled');
  } finally {
    drain.resolve();
    await stopping;
  }
});

test('failed bundle pin stays fail-closed instead of fabricating cleanup', async () => {
  jest.spyOn(fs, 'copyFile').mockRejectedValueOnce(new Error('copy failed'));
  await expect(startAsync(boot, 'source')).rejects.toThrow('copy failed');
  expect((await readLauncherStateAsync(boot))?.status).toBe('starting');
  await expect(startAsync(boot, 'source')).rejects.toThrow('already');
  expect(commands.start).not.toHaveBeenCalled();
});

test('startup returns native identity and effective paths in the single ready record', async () => {
  const [completion] = await beginSession();
  const ready = await status('ready');
  expect(ready).toMatchObject({
    controllerPid: process.pid,
    controllerStartTime: 'Thu Oct 22 10:00:00 2026',
    device: { udid: 'PHONE' },
  });
  expect(ready?.agentDeviceStateDir).toContain(root);
  expect(ready?.argentEventLogPath).toContain(root);
  expect(await fs.readdir(path.join(root, 'control'))).toEqual([
    path.basename(LAUNCHER_STATE_FILE),
  ]);
  await stopAsync(boot);
  expect(await completion).toBeUndefined();
});

for (const slower of ['boot', 'config']) {
  test(`serve-sim and agent depend only on boot while ${slower} is pending`, async () => {
    const booting = deferred<string>();
    const config = deferred<string>();
    const original = jest.mocked(commands.runAsync).getMockImplementation()!;
    jest
      .mocked(commands.runAsync)
      .mockImplementation((file, args, signal) =>
        args.includes('bootstatus')
          ? booting.promise
          : args.includes('artifacts-list-endpoint')
            ? config.promise
            : original(file, args, signal)
      );
    const [completion] = await beginSession();
    try {
      await until(() =>
        jest
          .mocked(commands.runAsync)
          .mock.calls.some(([, args]) => args.includes('artifacts-list-endpoint'))
      );
      if (slower === 'config') {
        booting.resolve('');
        await until(() => jobs.length === 2);
        expect(jobs).toHaveLength(2);
      } else {
        config.resolve('');
        await new Promise(resolve => setImmediate(resolve));
        expect(jobs).toHaveLength(0);
      }
      booting.resolve('');
      config.resolve('');
      await status('ready');
      expect(jobs).toHaveLength(3);
      await stopAsync(boot);
      expect(await completion).toBeUndefined();
    } finally {
      booting.resolve('');
      config.resolve('');
    }
  });
}

test('prepare failure drains owned services and records the failure after confirmed cleanup', async () => {
  jest.mocked(commands.start).mockImplementation((_file, args) => {
    const job = {
      child: { pid: 90000 + jobs.length, exitCode: null, signalCode: null } as ChildProcess,
      resultPromise: args.includes('prepare')
        ? Promise.reject(new Error('prepare failed'))
        : Promise.resolve(''),
    };
    void job.resultPromise.catch(() => {});
    jobs.push(job);
    return job;
  });
  const [completion] = await beginSession();
  expect(((await completion) as Error).message).toBe('prepare failed');
  expect(
    jest.mocked(processes.stopProcessAndDescendantsAsync).mock.calls.map(([job]) => job)
  ).toEqual(jobs);
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'disabled',
    error: 'prepare failed',
  });
});

test('failed cleanup remains stopping with a reason and never reports disabled', async () => {
  const [completion] = await beginSession();
  await status('ready');
  jest
    .mocked(processes.stopProcessAndDescendantsAsync)
    .mockRejectedValue(new Error('owned child still running'));
  process.emit('SIGTERM', 'SIGTERM');
  expect(await completion).toBeInstanceOf(AggregateError);
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'stopping',
    error: expect.stringContaining('cleanup could not be confirmed'),
  });
});

for (const selector of [undefined, 'phone', 'iPhone 17 Pro']) {
  test(`claim selects ${selector ?? 'the warm device'} and returns the claimed metadata record`, async () => {
    const [completion] = await beginSession();
    await status('ready');
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    await claimAsync(boot, 'serve-sim', selector);
    const result = JSON.parse(String(output.mock.calls[0][0]));
    const replacement = selector === 'iPhone 17 Pro';
    expect(result).toMatchObject({
      bootUuid: boot,
      status: 'claimed',
      engine: 'serve-sim',
      controllerPid: process.pid,
      device: { udid: replacement ? 'PRO' : 'PHONE' },
    });
    expect(result.agentDeviceStateDir).toBeTruthy();
    expect(
      jest.mocked(commands.runAsync).mock.calls.filter(([, args]) => args.includes('devices'))
    ).toHaveLength(1);
    if (replacement) {
      const calls = jest.mocked(commands.runAsync).mock.calls;
      // The new device boots and the old one still shuts down; their order is concurrent.
      expect(calls.map(([, args]) => args.join(' '))).toEqual(
        expect.arrayContaining(['simctl bootstatus PRO -b', 'simctl shutdown PHONE'])
      );
      expect(startExpoGoPreinstall).toHaveBeenCalledTimes(1);
    }
    await expect(claimAsync(boot, 'argent')).rejects.toThrow('available');
    await stopAsync(boot);
    expect(await completion).toBeUndefined();
  });
}

test('a device snapshot miss refreshes once to select a newly available device', async () => {
  let lists = 0;
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation((file, args, signal) =>
    args.includes('devices')
      ? Promise.resolve(
          JSON.stringify({
            devices: {
              ios: [
                ...deviceList.devices.ios,
                ...(lists++ ? [{ name: 'iPhone 18', udid: 'NEW' }] : []),
              ],
            },
          })
        )
      : original(file, args, signal)
  );
  const [completion] = await beginSession();
  await status('ready');
  jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  await claimAsync(boot, 'argent', 'NEW');
  expect(lists).toBe(2);
  expect((await readLauncherStateAsync(boot))?.device?.udid).toBe('NEW');
  await stopAsync(boot);
  await completion;
});

for (const engine of ['serve-sim', 'agent-device', 'argent']) {
  test(`${engine} claim does not wait for unused tools, but terminal cleanup does`, async () => {
    const [completion] = await beginSession();
    await status('ready');
    const drain = deferred<void>();
    jest.mocked(processes.stopProcessAndDescendantsAsync).mockImplementation(async () => {
      await drain.promise;
    });
    const original = jest.mocked(commands.runAsync).getMockImplementation()!;
    jest
      .mocked(commands.runAsync)
      .mockImplementation((file, args, signal) =>
        args.includes('daemon') ? drain.promise.then(() => '') : original(file, args, signal)
      );
    jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      await claimAsync(boot, engine);
      expect((await readLauncherStateAsync(boot))?.status).toBe('claimed');
      const stopping = stopAsync(boot);
      await status('stopping');
      expect((await readLauncherStateAsync(boot))?.status).not.toBe('disabled');
      drain.resolve();
      await stopping;
      await completion;
    } finally {
      drain.resolve();
    }
  });
}

test('stop during replacement prevents a late claimed result and drains newly owned work', async () => {
  const [completion] = await beginSession();
  await status('ready');
  const entered = deferred<void>();
  const release = deferred<string>();
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation(async (file, args, signal) => {
    if (args.includes('bootstatus') && args.includes('PRO')) {
      entered.resolve();
      await release.promise;
      signal?.throwIfAborted();
    }
    return await original(file, args, signal);
  });
  const claiming = claimAsync(boot, 'serve-sim', 'PRO').catch(error => error);
  try {
    await entered.promise;
    const stopping = stopAsync(boot);
    await status('stopping');
    release.resolve('');
    await stopping;
    expect(await claiming).toBeInstanceOf(Error);
    await completion;
    expect(await readLauncherStateAsync(boot)).toMatchObject({ status: 'disabled' });
    expect(commands.runAsync).toHaveBeenCalledWith('xcrun', ['simctl', 'shutdown', 'PRO']);
  } finally {
    release.resolve('');
  }
});

test('claim joins an already-started Expo Go install and terminal stop drains the whole task', async () => {
  const preinstalledExpoGo = {
    udid: 'PHONE',
    bundleIdentifier: 'host.exp.Exponent',
    shortVersion: '58.0.7',
    version: '58.0.7',
  };
  const install = deferred<typeof preinstalledExpoGo>();
  const cleanup = deferred<void>();
  jest.mocked(startExpoGoPreinstall).mockReturnValue({
    resultPromise: cleanup.promise,
    claimAsync: jest.fn(() => install.promise),
    stopAsync: jest.fn(() => cleanup.promise),
  });
  const [completion] = await beginSession();
  await status('ready');
  jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  const claiming = claimAsync(boot, 'serve-sim');
  try {
    await status('claiming');
    expect((await readLauncherStateAsync(boot))?.status).not.toBe('claimed');
    install.resolve(preinstalledExpoGo);
    await claiming;
    // The claim record tells the job which Expo Go is already installed on this device.
    expect(await readLauncherStateAsync(boot)).toMatchObject({
      status: 'claimed',
      device: { udid: 'PHONE' },
      preinstalledExpoGo,
    });
    const stopping = stopAsync(boot);
    await status('stopping');
    expect((await readLauncherStateAsync(boot))?.status).not.toBe('disabled');
    cleanup.resolve();
    await stopping;
    await completion;
  } finally {
    install.resolve(preinstalledExpoGo);
    cleanup.resolve();
  }
});

test.each(['install', 'run', 'adopt', 'prepare'])('rejects removed command %s', async command => {
  await expect(mainAsync([command])).rejects.toThrow('Usage:');
  expect(commands.runAsync).not.toHaveBeenCalled();
});
for (const target of ['linux', 'win32']) {
  test(`rejects ${target} before state or native work`, async () => {
    Object.defineProperty(process, 'platform', { value: target });
    await expect(mainAsync(['start'])).rejects.toThrow('requires macOS');
    expect(await fs.readdir(path.join(root, 'control'))).toEqual([]);
  });
}

test('package stop and claim use the installed bundle through Node', async () => {
  const directory = path.join(root, '.expo/simulator-tools');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'run'), 'installed implementation');
  await mainAsync(['stop']);
  await mainAsync(['claim', 'argent', 'iPhone 17 Pro']);
  expect(commands.start).toHaveBeenNthCalledWith(1, process.execPath, [
    path.join(directory, 'run'),
    'stop',
  ]);
  expect(commands.start).toHaveBeenNthCalledWith(2, process.execPath, [
    path.join(directory, 'run'),
    'claim',
    'argent',
    'iPhone 17 Pro',
  ]);
  expect(commands.runAsync).not.toHaveBeenCalled();
});

test.each(['stop', 'claim'])(
  'installed %s forwards signals, waits for completion and propagates delegated ENOENT',
  async command => {
    const directory = path.join(root, '.expo/simulator-tools');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'run'), 'installed implementation');
    const completion = deferred<string>();
    const child = { kill: jest.fn() } as unknown as ChildProcess;
    jest.mocked(commands.start).mockReturnValue({ child, resultPromise: completion.promise });
    const term = process.listenerCount('SIGTERM'),
      int = process.listenerCount('SIGINT');
    let finished = false;
    const result = mainAsync([command, 'serve-sim']).catch(error => error);
    void result.then(() => {
      finished = true;
    });
    try {
      await until(() => jest.mocked(commands.start).mock.calls.length === 1);
      process.emit('SIGTERM', 'SIGTERM');
      process.emit('SIGINT', 'SIGINT');
      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGINT');
      expect(finished).toBe(false);
      const error = Object.assign(new Error('installed command failed'), { code: 'ENOENT' });
      completion.reject(error);
      expect(await result).toBe(error);
      expect(commands.runAsync).not.toHaveBeenCalled();
      expect(await fs.readdir(directory)).toEqual(['run']);
      expect(process.listenerCount('SIGTERM')).toBe(term);
      expect(process.listenerCount('SIGINT')).toBe(int);
    } finally {
      completion.resolve('');
      await result;
    }
  }
);

test.each([
  ['Shutdown', true],
  ['Booted', false],
])('a failed shutdown of a device that is %s counts as done: %s', async (state, done) => {
  const failure = Object.assign(new Error('xcrun exited with 149.'), { code: 149 });
  jest.mocked(commands.runAsync).mockImplementation(async (_file, args) => {
    if (args.includes('shutdown')) {
      throw failure;
    }
    return JSON.stringify({ devices: { ios: [{ udid: 'OLD', state }] } });
  });
  const shutdown = shutdownSimulatorAsync('OLD');
  if (done) {
    await expect(shutdown).resolves.toBeUndefined();
  } else {
    await expect(shutdown).rejects.toBe(failure);
  }
});
