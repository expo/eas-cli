import { type ChildProcess } from 'node:child_process';

import { createWarmSimulatorSession } from '../commands/start';
import { createArgentTool } from '../utils/argent';
import { startExpoGoPreinstall } from '../utils/expoGo';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
} from '../utils/processes';
import { startServeSim, waitForServeSimReadyAsync } from '../utils/serveSim';
import {
  disableApsdAsync,
  shutdownSimulatorAsync,
  waitForSimulatorBootAsync,
} from '../utils/simulator';
import { deferred, until } from './helpers';

jest.mock('../utils/expoGo');
jest.mock('../utils/argent');
jest.mock('../utils/processes');
jest.mock('../utils/serveSim');
jest.mock('../utils/simulator', () => ({
  ...jest.requireActual('../utils/simulator'),
  shutdownSimulatorAsync: jest.fn(),
  disableApsdAsync: jest.fn(),
  waitForSimulatorBootAsync: jest.fn(),
}));

const defaultDevice = { udid: 'DUO', name: 'iPhone Duo' };
const secondary = { udid: 'PHONE18', name: 'iPhone 18' };
const otherDevice = { udid: 'OTHER', name: 'iPhone Pro' };
const serverInfo = {
  startupDevice: 'DUO',
  pid: 10,
  nativeStartTime: 'server-start',
  port: 3200,
  url: 'http://127.0.0.1:3200',
  token: 'fixture-token',
};
function handle(pid: number): ChildProcessHandle {
  return { child: { pid } as ChildProcess, resultPromise: Promise.resolve('') };
}
const server = handle(10);
const agent = handle(11);
const argent = handle(12);
let controller: AbortController;
let env: NodeJS.ProcessEnv;
let onPreparationFailure: jest.Mock;
let onBackgroundFailure: jest.Mock;
const starts = (word: string) =>
  jest.mocked(commands.start).mock.calls.filter(([, args]) => args.includes(word));
function createSession() {
  return createWarmSimulatorSession({
    signal: controller.signal,
    throwIfStoppingAsync: async () => controller.signal.throwIfAborted(),
    onPreparationFailure,
    onBackgroundFailure,
  });
}

/** The default device's Expo Go preinstall finishes with `install`; later devices finish at once. */
function mockDefaultExpoGoInstall(install: Promise<void>) {
  const preinstall = {
    preinstallOnDeviceAsync: jest.fn().mockReturnValueOnce(install).mockResolvedValue(undefined),
    claimAsync: jest.fn(async () => undefined),
    stopAsync: jest.fn(async () => {}),
  };
  jest.mocked(startExpoGoPreinstall).mockReturnValue(preinstall);
  return preinstall;
}

beforeEach(() => {
  jest.resetAllMocks();
  env = { ...process.env };
  process.env.EXPO_SIMULATOR_DEVICE = 'iPhone Duo,iPhone 18';
  process.env.AGENT_DEVICE_STATE_DIR = '/fixture/agent';
  process.env.ARGENT_EVENT_LOG = '/fixture/argent-events';
  controller = new AbortController();
  onPreparationFailure = jest.fn(error => controller.abort(error));
  onBackgroundFailure = jest.fn(error => controller.abort(error));
  jest.mocked(commands.runAsync).mockImplementation(async (_file, args) => {
    if (args.includes('devices')) {
      return JSON.stringify({ devices: { ios: [defaultDevice, secondary, otherDevice] } });
    }
    if (args.includes('launchctl') && args.includes('list')) {
      throw Object.assign(new Error('not loaded'), { code: 113 });
    }
    return 'controller-start';
  });
  jest
    .mocked(commands.start)
    .mockImplementation((_file, args) => (args.includes('prepare') ? agent : argent));
  jest.mocked(createArgentTool).mockImplementation(() => ({
    name: 'argent',
    startAsync: async () => {
      commands.start('bunx', ['argent', 'server']);
    },
    stopAsync: async () => {
      await stopProcessAndDescendantsAsync(argent);
    },
  }));
  jest.mocked(startServeSim).mockReturnValue(server);
  jest.mocked(waitForServeSimReadyAsync).mockResolvedValue(serverInfo);
  jest.mocked(waitForSimulatorBootAsync).mockResolvedValue();
  jest.mocked(stopProcessAndDescendantsAsync).mockResolvedValue();
  jest.mocked(shutdownSimulatorAsync).mockResolvedValue();
  jest
    .mocked(disableApsdAsync)
    .mockImplementation(jest.requireActual('../utils/simulator').disableApsdAsync);
  jest.mocked(startExpoGoPreinstall).mockReturnValue({
    preinstallOnDeviceAsync: jest.fn(async () => {}),
    claimAsync: jest.fn(async () => undefined),
    stopAsync: jest.fn(async () => {}),
  });
});
afterEach(() => {
  process.env = env;
  jest.restoreAllMocks();
});

it('creates a stoppable owner before any native work and does not start after stop', async () => {
  const session = createSession();
  expect(commands.runAsync).not.toHaveBeenCalled();
  await session.stopAsync();
  await expect(session.prepareAsync()).rejects.toThrow();
  expect(startServeSim).not.toHaveBeenCalled();
  expect(shutdownSimulatorAsync).not.toHaveBeenCalled();
});

it('stop joins pending device selection without starting a late server', async () => {
  const listing = deferred<string>();
  jest.mocked(commands.runAsync).mockReturnValueOnce(listing.promise);
  const session = createSession();
  const preparing = session.prepareAsync();
  void preparing.catch(() => {});
  let stopped = false;
  const stopping = session.stopAsync().then(() => {
    stopped = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(stopped).toBe(false);
  listing.resolve(JSON.stringify({ devices: { ios: [defaultDevice] } }));
  await stopping;
  await expect(preparing).rejects.toThrow();
  expect(startServeSim).not.toHaveBeenCalled();
});

it('starts one orphan with all configured devices and keeps its identity separate from selection', async () => {
  const session = createSession();
  const info = await session.prepareAsync();
  expect(startServeSim).toHaveBeenCalledWith(['DUO', 'PHONE18'], expect.any(AbortSignal));
  expect(info).toMatchObject({
    device: defaultDevice,
    server: serverInfo,
    controllerPid: process.pid,
    controllerStartTime: 'controller-start',
  });
  const selected = await session.claimAsync({ engine: 'serve-sim', requestedDevice: 'OTHER' });
  expect(selected.device).toEqual(otherDevice);
  expect(startServeSim).toHaveBeenCalledTimes(1);
  expect(commands.runAsync).not.toHaveBeenCalledWith(
    'xcrun',
    expect.arrayContaining(['bootstatus']),
    expect.anything()
  );
  await session.stopAsync();
  expect(shutdownSimulatorAsync).toHaveBeenCalledWith('DUO');
  expect(shutdownSimulatorAsync).toHaveBeenCalledWith('PHONE18');
  expect(shutdownSimulatorAsync).toHaveBeenCalledWith('OTHER');
});

it('publishes default readiness without joining Expo Go or requested-tool startup', async () => {
  const install = deferred();
  const preparing = deferred<string>();
  mockDefaultExpoGoInstall(install.promise);
  jest
    .mocked(commands.start)
    .mockImplementation((_file, args) =>
      args.includes('prepare') ? { ...agent, resultPromise: preparing.promise } : argent
    );
  const session = createSession();
  try {
    await session.prepareAsync();
    await expect(session.claimAsync({ engine: 'agent-device' })).resolves.toMatchObject({
      device: defaultDevice,
    });
    expect(starts('prepare')).toHaveLength(1);
  } finally {
    preparing.resolve('');
    install.resolve();
    await session.stopAsync();
  }
});

it('primes the exact version once before readiness and bounds two failed attempts', async () => {
  const priming = deferred<string>();
  const run = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest
    .mocked(commands.runAsync)
    .mockImplementation((file, args, signal) =>
      file === 'bun' ? priming.promise : run(file, args, signal)
    );
  const session = createSession();
  let ready = false;
  const preparing = session.prepareAsync().then(() => {
    ready = true;
  });
  await until(() => jest.mocked(commands.runAsync).mock.calls.some(([file]) => file === 'bun'));
  expect(ready).toBe(false);
  expect(jest.mocked(commands.runAsync).mock.calls.filter(([file]) => file === 'bun')).toHaveLength(
    1
  );
  priming.resolve('25.3.0');
  await preparing;
  await session.stopAsync();
});

it('consumed claim forbids the secondary preinstall of a device still booting', async () => {
  const preinstall = mockDefaultExpoGoInstall(Promise.resolve());
  jest.mocked(waitForSimulatorBootAsync).mockImplementation(async (udid, signal) => {
    if (udid === 'PHONE18') {
      await new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      );
    }
  });
  const session = createSession();
  await session.prepareAsync();
  await until(() => jest.mocked(waitForSimulatorBootAsync).mock.calls.length === 2);
  await session.claimAsync({ engine: 'serve-sim' });
  await session.stopAsync();
  expect(preinstall.preinstallOnDeviceAsync).not.toHaveBeenCalledWith(
    'PHONE18',
    expect.anything(),
    expect.anything()
  );
});

it('a secondary boot observation failure leaves the claimed default usable', async () => {
  jest
    .mocked(waitForSimulatorBootAsync)
    .mockImplementation(async udid =>
      udid === 'PHONE18' ? Promise.reject(new Error('optional boot failed')) : undefined
    );
  const session = createSession();
  await session.prepareAsync();
  await until(() => jest.mocked(waitForSimulatorBootAsync).mock.calls.length === 2);
  await expect(session.claimAsync({ engine: 'serve-sim' })).resolves.toMatchObject({
    device: defaultDevice,
  });
  expect(onPreparationFailure).not.toHaveBeenCalled();
  expect(onBackgroundFailure).not.toHaveBeenCalled();
  await session.stopAsync();
});

it('claim latches preinstalls before async selection and joins only actual install promises', async () => {
  const installation = deferred<undefined>();
  const preinstall = startExpoGoPreinstall(controller.signal);
  jest
    .mocked(preinstall.claimAsync)
    .mockImplementation(udid =>
      udid === 'PHONE18' ? installation.promise : Promise.resolve(undefined)
    );
  const session = createSession();
  await session.prepareAsync();
  let claimed = false;
  const claiming = session
    .claimAsync({ engine: 'serve-sim', requestedDevice: 'iPhone 18' })
    .then(value => {
      claimed = true;
      return value;
    });
  expect(preinstall.claimAsync).toHaveBeenCalledWith('DUO');
  expect(preinstall.claimAsync).toHaveBeenCalledWith('PHONE18');
  await new Promise(resolve => setImmediate(resolve));
  expect(claimed).toBe(false);
  installation.resolve(undefined);
  expect((await claiming).device).toEqual(secondary);
  await session.stopAsync();
});

it('unused preinstall failure does not reject a default claim, but terminal stop retains uncertainty', async () => {
  const failure = new Error('unused install not drained');
  const preinstall = startExpoGoPreinstall(controller.signal);
  jest.mocked(preinstall.claimAsync).mockImplementation(async udid => {
    if (udid === 'PHONE18') {
      throw failure;
    }
    return undefined;
  });
  jest.mocked(preinstall.stopAsync).mockImplementation(async udid => {
    if (udid === 'PHONE18') {
      throw failure;
    }
  });
  const session = createSession();
  await session.prepareAsync();
  await expect(session.claimAsync({ engine: 'serve-sim' })).resolves.toMatchObject({
    device: defaultDevice,
  });
  expect(onBackgroundFailure).not.toHaveBeenCalled();
  await expect(session.stopAsync()).rejects.toMatchObject({ errors: [failure] });
  expect(shutdownSimulatorAsync).toHaveBeenCalledWith('DUO');
});

it('retains selected preinstall failure instead of handing over an uncertain install', async () => {
  const failure = new Error('selected install failed');
  const preinstall = startExpoGoPreinstall(controller.signal);
  jest.mocked(preinstall.claimAsync).mockRejectedValue(failure);
  const session = createSession();
  await session.prepareAsync();
  await expect(session.claimAsync({ engine: 'serve-sim' })).rejects.toBe(failure);
  await session.stopAsync();
});

it('reuses the default runner after adoption without preparing it twice', async () => {
  const preparation = deferred<string>();
  jest
    .mocked(commands.start)
    .mockImplementation((_file, args) =>
      args.includes('prepare') ? { ...agent, resultPromise: preparation.promise } : argent
    );
  const session = createSession();
  await session.prepareAsync();
  await session.claimAsync({ engine: 'agent-device' });
  let ready = false;
  const tools = session.prepareToolsAsync().then(() => {
    ready = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(ready).toBe(false);
  preparation.resolve('');
  await tools;
  expect(starts('prepare')).toHaveLength(1);
  await session.stopAsync();
});

it('starts the selected runner only in the post-adopt phase, after old runner retirement', async () => {
  const retirement = deferred();
  jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async handle => {
    if (handle === agent) {
      await retirement.promise;
    }
  });
  const session = createSession();
  await session.prepareAsync();
  await session.claimAsync({ engine: 'agent-device', requestedDevice: 'PHONE18' });
  expect(starts('prepare')).toHaveLength(1);
  let finished = false;
  const tools = session.prepareToolsAsync().then(() => {
    finished = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(finished).toBe(false);
  expect(starts('prepare')).toHaveLength(1);
  retirement.resolve();
  await tools;
  expect(starts('prepare')[1][1]).toEqual(expect.arrayContaining(['--udid', 'PHONE18']));
  await session.stopAsync();
});

it('keeps global Argent when selecting another device', async () => {
  const session = createSession();
  await session.prepareAsync();
  await session.claimAsync({ engine: 'argent', requestedDevice: 'PHONE18' });
  await session.prepareToolsAsync();
  expect(starts('server')).toHaveLength(1);
  expect(stopProcessAndDescendantsAsync).not.toHaveBeenCalledWith(argent);
  await session.stopAsync();
});

it('rejects a changed server identity before starting the selected runner', async () => {
  const session = createSession();
  await session.prepareAsync();
  await session.claimAsync({ engine: 'agent-device', requestedDevice: 'PHONE18' });
  jest.mocked(waitForServeSimReadyAsync).mockResolvedValueOnce({ ...serverInfo, pid: 99 });
  await expect(session.prepareToolsAsync()).rejects.toThrow('does not match');
  expect(starts('prepare')).toHaveLength(1);
  await session.stopAsync();
});

it('drains partial preparation, all shutdowns and sibling failures before rejecting cleanup', async () => {
  const readyFailure = new Error('server not ready');
  jest.mocked(waitForServeSimReadyAsync).mockRejectedValue(readyFailure);
  const failure = new Error('server stop failed');
  jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async handle => {
    if (handle === server) {
      throw failure;
    }
  });
  const delayed = deferred();
  jest.mocked(shutdownSimulatorAsync).mockImplementation(async udid => {
    if (udid === 'PHONE18') {
      await delayed.promise;
    }
  });
  const session = createSession();
  await expect(session.prepareAsync()).rejects.toBe(readyFailure);
  let finished = false;
  const stopping = session.stopAsync().finally(() => {
    finished = true;
  });
  void stopping.catch(() => {});
  await until(() => jest.mocked(shutdownSimulatorAsync).mock.calls.length === 2);
  expect(finished).toBe(false);
  delayed.resolve();
  await expect(stopping).rejects.toMatchObject({ errors: [failure] });
});

it('serve-sim tool preparation does not gate on unused tool stops, but terminal cleanup drains them', async () => {
  const retirement = deferred();
  jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async handle => {
    if (handle === agent) {
      await retirement.promise;
    }
  });
  const session = createSession();
  await session.prepareAsync();
  await session.claimAsync({ engine: 'serve-sim' });
  await session.prepareToolsAsync();
  let stopped = false;
  const stopping = session.stopAsync().then(() => {
    stopped = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(stopped).toBe(false);
  retirement.resolve();
  await stopping;
});

it('starts an owned nonblocking apsd attempt after selected adoption and drains it before shutdown', async () => {
  const session = createSession();
  await session.prepareAsync();
  await session.claimAsync({ engine: 'serve-sim', requestedDevice: 'OTHER' });
  const setup = deferred();
  const disable = jest.mocked(disableApsdAsync).mockImplementation(() => setup.promise);
  try {
    await session.prepareToolsAsync();
    expect(disable).toHaveBeenCalledWith('OTHER', expect.any(AbortSignal));
    let stopped = false;
    const stopping = session.stopAsync().then(() => {
      stopped = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    expect(shutdownSimulatorAsync).not.toHaveBeenCalled();
    setup.resolve();
    await stopping;
    expect(shutdownSimulatorAsync).toHaveBeenCalledWith('OTHER');
  } finally {
    setup.resolve();
    await session.stopAsync();
  }
});

it('does not repeat completed default-device setup after adoption', async () => {
  const session = createSession();
  await session.prepareAsync();
  jest.mocked(disableApsdAsync).mockClear();
  await session.claimAsync({ engine: 'serve-sim' });
  await session.prepareToolsAsync();
  expect(disableApsdAsync).not.toHaveBeenCalled();
  await session.stopAsync();
});

it('reports ready before apsd finishes, but the claim waits for it', async () => {
  const disabled = deferred();
  jest.mocked(disableApsdAsync).mockImplementation(() => disabled.promise);
  const session = createSession();
  await session.prepareAsync();
  expect(disableApsdAsync).toHaveBeenCalledWith('DUO', expect.any(AbortSignal));
  let claimed = false;
  const claiming = session.claimAsync({ engine: 'serve-sim' }).then(() => {
    claimed = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(claimed).toBe(false);
  disabled.resolve();
  await claiming;
  await session.stopAsync();
});

it('does not report a background failure when a stop aborts the default setup', async () => {
  const disable = jest
    .mocked(disableApsdAsync)
    .mockImplementation(
      (_udid, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
    );
  const session = createSession();
  const preparing = session.prepareAsync().catch(() => {});
  await until(() => disable.mock.calls.length > 0);
  await session.stopAsync();
  await preparing;
  await new Promise(resolve => setImmediate(resolve));
  expect(onBackgroundFailure).not.toHaveBeenCalled();
});

it('runs the setup again for an extra device whose warmup the claim cancelled', async () => {
  const disable = jest
    .mocked(disableApsdAsync)
    .mockImplementation((udid, signal) =>
      udid === 'PHONE18'
        ? new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          )
        : Promise.resolve()
    );
  const session = createSession();
  await session.prepareAsync();
  await until(() => disable.mock.calls.some(([udid]) => udid === 'PHONE18'));
  await session.claimAsync({ engine: 'serve-sim', requestedDevice: 'PHONE18' });
  disable.mockResolvedValue(undefined);
  await session.prepareToolsAsync();
  await until(() => disable.mock.calls.filter(([udid]) => udid === 'PHONE18').length === 2);
  await session.stopAsync();
});

it('warns on ordinary adopted-device apsd failure without failing the claimed session', async () => {
  const session = createSession();
  await session.prepareAsync();
  await session.claimAsync({ engine: 'serve-sim', requestedDevice: 'OTHER' });
  jest.mocked(disableApsdAsync).mockRejectedValue(new Error('apsd remains loaded'));
  const warning = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  await session.prepareToolsAsync();
  // The setup runs in the background; wait for its warning before stopping.
  await until(() =>
    warning.mock.calls.some(([text]) => String(text).includes('Could not disable apsd on OTHER'))
  );
  await session.stopAsync();
  expect(onPreparationFailure).not.toHaveBeenCalled();
  expect(onBackgroundFailure).not.toHaveBeenCalled();
  expect(warning.mock.calls.map(([text]) => text).join('')).toContain(
    'Could not disable apsd on OTHER; continuing'
  );
});
