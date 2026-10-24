import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { turtleFetch } from '../../../utils/turtleFetch';
import { listAgentDeviceArtifactsAsync } from '../agentDeviceArtifacts';
import { stopWarmIosSessionAsync, tryClaimWarmIosSessionAsync } from '../warmIosSession';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/turtleFetch');
jest.mock('../agentDeviceArtifacts');
jest.mock('../remoteDeviceRunSession', () => ({ isProcessRunning: jest.fn(() => true) }));

const UDID = '592047E9-7027-4394-8213-8924EFCD53F6';
const CONTROLLER_PID = 9000;
const CONTROLLER_START_TIME = 'Thu Oct 22 10:00:00 2026';
const SCRIPT = path.join(os.homedir(), '.expo/simulator-tools/run');
const STATE = '/tmp/expo-simulator-startup.json';
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as bunyan;
const env = { EAS_USE_WARM_SIMULATOR: '1' };
const stateDir = path.join(os.homedir(), 'Library/Caches/expo-simulator-startup/agent-device');

const originalPlatform = process.platform;
beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
});
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

async function writeAsync(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(async () => {
  jest.resetAllMocks();
  jest.mocked(spawn).mockImplementation((command, args, options) => {
    if (args[1] === 'claim') {
      return fs.readFile(STATE, 'utf8').then(contents => ({
        stdout: JSON.stringify({ ...JSON.parse(contents), status: 'claimed', engine: args[2] }),
      })) as ReturnType<typeof spawn>;
    }
    const stdout =
      command === '/usr/sbin/sysctl'
        ? 'boot-1\n'
        : command === 'ps' && args.includes('lstart=')
          ? CONTROLLER_START_TIME
          : command === 'ps'
            ? `${CONTROLLER_PID}\n`
            : '';
    return Promise.resolve({
      stdout: options?.stdio === 'pipe' || options?.logger ? stdout : '',
    }) as ReturnType<typeof spawn>;
  });
  jest.mocked(turtleFetch).mockImplementation(
    async url =>
      ({
        json: async () =>
          url.endsWith('/readyz')
            ? { status: 'ready', device: UDID }
            : url.endsWith('/tools')
              ? { tools: [] }
              : { version: '1.2.3' },
      }) as Awaited<ReturnType<typeof turtleFetch>>
  );
  jest.mocked(listAgentDeviceArtifactsAsync).mockResolvedValue([]);
  await writeAsync(SCRIPT, '# fixture');
  await writeAsync(STATE, {
    bootUuid: 'boot-1',
    status: 'ready',
    device: { udid: UDID, name: 'iPhone 17' },
    controllerPid: CONTROLLER_PID,
    controllerStartTime: CONTROLLER_START_TIME,
    agentDeviceStateDir: stateDir,
    argentEventLogPath: path.join(os.homedir(), '.argent/tool-server-events.jsonl'),
  });
  await writeAsync(path.join(os.tmpdir(), 'serve-sim', `server-${UDID}.json`), {
    pid: 10,
    port: 3200,
    token: 'serve-secret',
    device: UDID,
    url: 'http://127.0.0.1:3200',
  });
});

it('does not inspect or stop preparation without the job opt-in', async () => {
  expect(
    await tryClaimWarmIosSessionAsync({
      engine: 'serve-sim',
      requestedDevice: UDID,
      env: {},
      logger,
    })
  ).toBeUndefined();
  expect(spawn).not.toHaveBeenCalled();
});

it.each([
  'TMPDIR',
  'SERVE_SIM_STATE_DIR',
  'SERVE_SIM_ADDITIONAL_DYLIBS',
  'SIMCTL_CHILD_HTTP_PROXY',
])('uses the cold path for a job-specific %s override', async variable => {
  expect(
    await tryClaimWarmIosSessionAsync({
      engine: 'serve-sim',
      requestedDevice: UDID,
      env: { ...env, [variable]: '/custom/job-directory' },
      logger,
    })
  ).toBeUndefined();
  expect(turtleFetch).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '@expo/simulator-launcher@latest', 'stop'],
    expect.anything()
  );
  const [{ err }] = jest.mocked(logger.warn).mock.calls[0] as [{ err: Error }];
  expect(err.message).toContain(variable);
  expect(err.message).not.toContain('/custom/job-directory');
});

it('accepts job directory overrides that match the warmup defaults', async () => {
  const warm = await tryClaimWarmIosSessionAsync({
    engine: 'serve-sim',
    env: {
      ...env,
      TMPDIR: os.tmpdir(),
      SERVE_SIM_STATE_DIR: path.join(os.tmpdir(), 'serve-sim'),
    },
    logger,
  });
  expect(warm?.device.udid).toBe(UDID);
  expect(logger.warn).not.toHaveBeenCalled();
});

it('prepares the exact current-boot device and stops through the supervisor once', async () => {
  const signal = new AbortController().signal;
  const warm = await tryClaimWarmIosSessionAsync({
    engine: 'serve-sim',
    requestedDevice: UDID,
    packageVersion: '1.2.3',
    env,
    logger,
    signal,
  });
  expect(warm?.serveSim).toEqual({ pid: 10, port: 3200, token: 'serve-secret' });
  expect(turtleFetch).toHaveBeenCalledWith('http://127.0.0.1:3200/readyz', 'GET', {
    headers: { Authorization: 'Bearer serve-secret' },
    retries: 0,
    timeout: 5_000,
    signal,
  });
  expect(spawn).toHaveBeenCalledWith('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
    stdio: 'pipe',
  });
  expect(jest.mocked(turtleFetch).mock.calls.some(([url]) => url.endsWith('/session'))).toBe(false);
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    [SCRIPT, 'claim', 'serve-sim', UDID],
    expect.anything()
  );
  await Promise.all([warm!.process.stopAsync(), warm!.process.stopAsync()]);
  expect(jest.mocked(spawn).mock.calls.filter(([, args]) => args.includes('stop'))).toHaveLength(1);
});

it.each(['stale-boot', 'wrong-device', 'wrong-url'])(
  'cleans up %s before the caller falls back',
  async failure => {
    if (failure === 'stale-boot') {
      await writeAsync(STATE, {
        bootUuid: 'previous-boot',
        status: 'ready',
      });
    }
    if (failure !== 'stale-boot') {
      await writeAsync(path.join(os.tmpdir(), 'serve-sim', `server-${UDID}.json`), {
        pid: 10,
        port: 3200,
        token: 'serve-secret',
        device: failure === 'wrong-device' ? 'another-device' : UDID,
        url: failure === 'wrong-url' ? 'http://127.0.0.1:9999' : 'http://127.0.0.1:3200',
      });
    }
    expect(
      await tryClaimWarmIosSessionAsync({
        engine: 'serve-sim',
        requestedDevice: UDID,
        env,
        logger,
      })
    ).toBeUndefined();
    expect(spawn).toHaveBeenCalledWith(
      'bun',
      ['x', '@expo/simulator-launcher@latest', 'stop'],
      expect.anything()
    );
    expect(jest.mocked(spawn).mock.calls.some(([, args]) => args[1] === 'claim')).toBe(
      failure !== 'stale-boot'
    );
    if (failure !== 'stale-boot') {
      expect(logger.warn).toHaveBeenCalledWith(
        {
          err: new Error(
            failure === 'wrong-device'
              ? `Warm serve-sim reports device another-device, but claim returned ${UDID}.`
              : 'The warm serve-sim address does not match http://127.0.0.1:3200; the session cannot be reused.'
          ),
        },
        'The warm Simulator session cannot be used; cleanup is required before normal startup.'
      );
    }
  }
);

it('prepares a detached agent-device using its native process start time, custom state and auth', async () => {
  const stateDir = '/warm custom/agent';
  await writeAsync(STATE, {
    status: 'ready',
    device: { udid: UDID, name: 'iPhone 17' },
    bootUuid: 'boot-1',
    controllerPid: CONTROLLER_PID,
    controllerStartTime: CONTROLLER_START_TIME,
    agentDeviceStateDir: stateDir,
    argentEventLogPath: '/argent-events.jsonl',
  });
  await writeAsync(path.join(stateDir, 'daemon.json'), {
    pid: 30,
    httpPort: 12345,
    token: 'agent-secret',
    version: '1.2.3',
    stateDir,
    processStartTime: 'Thu Oct 22 10:00:00 2026',
  });
  const warm = await tryClaimWarmIosSessionAsync({
    engine: 'agent-device',
    requestedDevice: UDID,
    packageVersion: '1.2.3',
    env,
    logger,
  });
  expect(warm?.tools?.pid).toBe(30);
  expect(spawn).toHaveBeenCalledWith('ps', ['-p', '30', '-o', 'lstart='], { stdio: 'pipe' });
  expect(listAgentDeviceArtifactsAsync).toHaveBeenCalledWith({
    daemonUrl: 'http://127.0.0.1:12345',
    daemonToken: 'agent-secret',
    signal: expect.any(AbortSignal),
  });
  expect(
    jest
      .mocked(spawn)
      .mock.calls.some(
        ([command, args]) => command === 'ps' && args[1] === '30' && args.includes('ppid=')
      )
  ).toBe(false);
});

it('rejects a reused agent-device PID before claiming', async () => {
  await writeAsync(path.join(stateDir, 'daemon.json'), {
    pid: 30,
    httpPort: 12345,
    token: 'agent-secret',
    version: '1.2.3',
    stateDir,
    processStartTime: 'older process',
  });
  expect(
    await tryClaimWarmIosSessionAsync({
      engine: 'agent-device',
      requestedDevice: UDID,
      env,
      logger,
    })
  ).toBeUndefined();
  expect(listAgentDeviceArtifactsAsync).not.toHaveBeenCalled();
});

it('bounds the agent-device preflight and cleans up after an aborted inventory request', async () => {
  await writeAsync(path.join(stateDir, 'daemon.json'), {
    pid: 30,
    httpPort: 12345,
    token: 'agent-secret',
    version: '1.2.3',
    stateDir,
    processStartTime: 'Thu Oct 22 10:00:00 2026',
  });
  const timeout = jest.spyOn(AbortSignal, 'timeout');
  jest
    .mocked(listAgentDeviceArtifactsAsync)
    .mockRejectedValueOnce(new Error('inventory request aborted'));
  try {
    expect(
      await tryClaimWarmIosSessionAsync({
        engine: 'agent-device',
        requestedDevice: UDID,
        env,
        logger,
      })
    ).toBeUndefined();
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(spawn).toHaveBeenCalledWith(
      'bun',
      ['x', '@expo/simulator-launcher@latest', 'stop'],
      expect.anything()
    );
  } finally {
    timeout.mockRestore();
  }
});

it('prepares Argent through its native state and bundle manifest', async () => {
  const bundlePath = '/cache/argent/dist/tool-server.cjs';
  await writeAsync(path.join(os.homedir(), '.argent/tool-server-hash.json'), {
    pid: 40,
    port: 3201,
    token: 'argent-secret',
    bundlePath,
  });
  await writeAsync('/cache/argent/package.json', { version: '1.2.3' });
  const eventFile = '/warm custom/argent-events.jsonl';
  await writeAsync(STATE, {
    status: 'ready',
    device: { udid: UDID, name: 'iPhone 17' },
    bootUuid: 'boot-1',
    controllerPid: CONTROLLER_PID,
    controllerStartTime: CONTROLLER_START_TIME,
    agentDeviceStateDir: stateDir,
    argentEventLogPath: eventFile,
  });
  await writeAsync(path.join(os.homedir(), '.argent/tool-server-stale.json'), { port: 9999 });
  const warm = await tryClaimWarmIosSessionAsync({
    engine: 'argent',
    requestedDevice: UDID,
    packageVersion: '1.2.3',
    env,
    logger,
  });
  expect(warm?.tools).toEqual({ pid: 40, port: 3201, token: 'argent-secret' });
  expect(turtleFetch).toHaveBeenCalledWith('http://127.0.0.1:3201/tools', 'GET', {
    headers: { Authorization: 'Bearer argent-secret' },
    retries: 0,
    timeout: 5_000,
    signal: undefined,
  });
  expect(warm?.argentEventLogPath).toBe(eventFile);
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    [SCRIPT, 'claim', 'argent', UDID],
    expect.anything()
  );
});

it('skips Argent state left by another process on the same port', async () => {
  await writeAsync(path.join(os.homedir(), '.argent/tool-server-aaa.json'), {
    pid: 41,
    port: 3201,
    token: 'stale-secret',
    bundlePath: '/old/argent/dist/tool-server.cjs',
    version: '1.0.0',
  });
  await writeAsync(path.join(os.homedir(), '.argent/tool-server-hash.json'), {
    pid: 40,
    port: 3201,
    token: 'argent-secret',
    bundlePath: '/cache/argent/dist/tool-server.cjs',
  });
  await writeAsync('/cache/argent/package.json', { version: '1.2.3' });
  const original = jest.mocked(spawn).getMockImplementation()!;
  jest
    .mocked(spawn)
    .mockImplementation((file, args, options) =>
      file === 'ps' && args[1] === '41' && args.includes('ppid=')
        ? (Promise.resolve({ stdout: '1' }) as ReturnType<typeof spawn>)
        : original(file, args, options)
    );
  const warm = await tryClaimWarmIosSessionAsync({
    engine: 'argent',
    requestedDevice: UDID,
    packageVersion: '1.2.3',
    env,
    logger,
  });
  expect(warm?.tools).toEqual({ pid: 40, port: 3201, token: 'argent-secret' });
});

it.each(['missing', 'malformed', 'wrong-boot'])(
  'stops before cold fallback when effective config is %s',
  async failure => {
    const file = STATE;
    if (failure === 'missing') {
      await fs.rm(file);
    } else {
      await writeAsync(
        file,
        failure === 'malformed'
          ? 'not JSON'
          : {
              bootUuid: 'previous-boot',
              agentDeviceStateDir: stateDir,
              argentEventLogPath: '/events.jsonl',
            }
      );
    }
    expect(
      await tryClaimWarmIosSessionAsync({
        engine: 'agent-device',
        requestedDevice: UDID,
        env,
        logger,
      })
    ).toBeUndefined();
    expect(listAgentDeviceArtifactsAsync).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      'bun',
      ['x', '@expo/simulator-launcher@latest', 'stop'],
      expect.anything()
    );
    expect(jest.mocked(spawn).mock.calls.some(([, args]) => args[1] === 'claim')).toBe(false);
  }
);

it('propagates failed stop instead of permitting cold fallback', async () => {
  await fs.rm(STATE);
  const original = jest.mocked(spawn).getMockImplementation()!;
  const failure = new Error('worker stop timed out');
  jest.mocked(spawn).mockImplementation((command, args, options) => {
    if (args.includes('stop')) {
      return Promise.reject(failure) as ReturnType<typeof spawn>;
    }
    return original(command, args, options);
  });
  await expect(
    tryClaimWarmIosSessionAsync({ engine: 'serve-sim', requestedDevice: UDID, env, logger })
  ).rejects.toBe(failure);
});

it('lets claim choose the device, then runs preflight against the returned identity', async () => {
  const actual = 'A8E19807-41B2-4785-9558-08C1D52833C9';
  const original = jest.mocked(spawn).getMockImplementation()!;
  jest.mocked(spawn).mockImplementation((command, args, options) =>
    args[1] === 'claim'
      ? (writeAsync(STATE, {
          bootUuid: 'boot-1',
          status: 'claimed',
          engine: args[2],
          controllerPid: CONTROLLER_PID,
          controllerStartTime: CONTROLLER_START_TIME,
          agentDeviceStateDir: stateDir,
          argentEventLogPath: path.join(os.homedir(), '.argent/tool-server-events.jsonl'),
          device: { udid: actual, name: 'iPhone 17 Pro' },
        }).then(() => ({
          stdout: JSON.stringify({
            bootUuid: 'boot-1',
            status: 'claimed',
            engine: args[2],
            controllerPid: CONTROLLER_PID,
            controllerStartTime: CONTROLLER_START_TIME,
            agentDeviceStateDir: stateDir,
            argentEventLogPath: path.join(os.homedir(), '.argent/tool-server-events.jsonl'),
            device: { udid: actual, name: 'iPhone 17 Pro' },
          }),
        })) as ReturnType<typeof spawn>)
      : original(command, args, options)
  );
  await writeAsync(path.join(os.tmpdir(), 'serve-sim', `server-${actual}.json`), {
    pid: 10,
    port: 3200,
    token: 'serve-secret',
    device: actual,
    url: 'http://127.0.0.1:3200',
  });
  jest
    .mocked(turtleFetch)
    .mockResolvedValue({ json: async () => ({ status: 'ready', device: actual }) } as Awaited<
      ReturnType<typeof turtleFetch>
    >);
  const warm = await tryClaimWarmIosSessionAsync({
    engine: 'serve-sim',
    requestedDevice: 'iPhone 17 Pro',
    env,
    logger,
  });
  expect(warm?.device).toEqual({ udid: actual, name: 'iPhone 17 Pro' });
  const calls = jest.mocked(spawn).mock.calls;
  expect(calls.findIndex(([, args]) => args[1] === 'claim')).toBeLessThan(
    calls.findIndex(([command]) => command === 'ps')
  );
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    [SCRIPT, 'claim', 'serve-sim', 'iPhone 17 Pro'],
    expect.objectContaining({ timeout: 425_000 })
  );
  expect(calls.some(([command]) => command === 'xcrun')).toBe(false);
});

it('passes no selector when the caller wants the current warm device', async () => {
  const warm = await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger });
  expect(warm?.device).toEqual({ udid: UDID, name: 'iPhone 17' });
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    [SCRIPT, 'claim', 'serve-sim'],
    expect.objectContaining({ timeout: 425_000 })
  );
});

it.each([
  'boot-1\n',
  { bootUuid: 'boot-1', status: 'disabled' },
  {
    bootUuid: 'boot-1',
    status: 'claimed',
    engine: 'serve-sim',
    device: { udid: UDID, name: 'iPhone 17' },
  },
])('does not claim an old-format or unavailable initial status %j', async status => {
  await writeAsync(STATE, status);
  expect(await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })).toBeUndefined();
  expect(jest.mocked(spawn).mock.calls.some(([, args]) => args[1] === 'claim')).toBe(false);
  expect(turtleFetch).not.toHaveBeenCalled();
});

it.each([
  { bootUuid: 'other-boot' },
  { engine: 'argent' },
  { status: 'ready' },
  { controllerPid: 0 },
  { controllerStartTime: '' },
  { agentDeviceStateDir: '' },
  { argentEventLogPath: '' },
  { device: { udid: '', name: 'iPhone' } },
])('rejects invalid claimed metadata response %j after positive stop', async invalid => {
  const original = jest.mocked(spawn).getMockImplementation()!;
  jest.mocked(spawn).mockImplementation((command, args, options) => {
    const result = original(command, args, options);
    return (
      args[1] === 'claim'
        ? result.then(value => ({
            ...value,
            stdout: JSON.stringify({ ...JSON.parse(value.stdout), ...invalid }),
          }))
        : result
    ) as ReturnType<typeof spawn>;
  });
  await expect(tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })).rejects.toThrow();
  expect(turtleFetch).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '@expo/simulator-launcher@latest', 'stop'],
    expect.anything()
  );
});

it.each(['', 'not-json', '{"udid":"","name":"iPhone"}', '{"udid":"PHONE","name":""}'])(
  'terminal-stops and fails claim for invalid CLI device output %s',
  async stdout => {
    const original = jest.mocked(spawn).getMockImplementation()!;
    jest
      .mocked(spawn)
      .mockImplementation((command, args, options) =>
        args[1] === 'claim'
          ? (Promise.resolve({ stdout }) as ReturnType<typeof spawn>)
          : original(command, args, options)
      );
    await expect(
      tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })
    ).rejects.toThrow();
    expect(spawn).toHaveBeenCalledWith(
      'bun',
      ['x', '@expo/simulator-launcher@latest', 'stop'],
      expect.objectContaining({ timeout: 150_000 })
    );
    expect(turtleFetch).not.toHaveBeenCalled();
  }
);

it.each(['missing', 'wrong-boot'])(
  'does not enter the long claim wait for a %s initial candidate',
  async failure => {
    if (failure === 'missing') {
      await fs.rm(STATE);
    } else {
      await writeAsync(STATE, {
        bootUuid: 'other-boot',
        status: 'ready',
      });
    }
    expect(await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })).toBeUndefined();
    expect(jest.mocked(spawn).mock.calls.some(([, args]) => args[1] === 'claim')).toBe(false);
  }
);

it.each(['request-timeout', 'command-cancelled'])(
  'awaits positive terminal stop after %s before resolving or rejecting claim',
  async failure => {
    let acknowledge!: () => void;
    const cleanup = new Promise<void>(resolve => {
      acknowledge = resolve;
    });
    const controller = new AbortController();
    const original = jest.mocked(spawn).getMockImplementation()!;
    let stopEntered = false;
    let completed = false;
    const reason = new Error(failure);
    jest.mocked(spawn).mockImplementation((command, args, options) => {
      if (args[1] === 'claim') {
        if (failure === 'command-cancelled') {
          controller.abort(reason);
        }
        return Promise.reject(reason) as ReturnType<typeof spawn>;
      }
      if (args.includes('stop')) {
        stopEntered = true;
        expect(options).not.toHaveProperty('signal');
        return cleanup.then(() => ({ stdout: '' })) as ReturnType<typeof spawn>;
      }
      return original(command, args, options);
    });
    const preparation = tryClaimWarmIosSessionAsync({
      engine: 'serve-sim',
      env,
      logger,
      signal: controller.signal,
    }).then(
      value => {
        completed = true;
        return value;
      },
      error => {
        completed = true;
        return error;
      }
    );
    try {
      for (let i = 0; i < 100 && !stopEntered; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(stopEntered).toBe(true);
      expect(completed).toBe(false);
      acknowledge();
      expect(await preparation).toBe(reason);
    } finally {
      acknowledge();
      await preparation;
    }
  }
);

it('propagates a terminal-stop failure after the accepted request times out', async () => {
  const original = jest.mocked(spawn).getMockImplementation()!;
  const teardownError = new Error('no positive stopped ack');
  jest.mocked(spawn).mockImplementation((command, args, options) => {
    if (args[1] === 'claim') {
      return Promise.reject(new Error('request timed out')) as ReturnType<typeof spawn>;
    }
    if (args.includes('stop')) {
      return Promise.reject(teardownError) as ReturnType<typeof spawn>;
    }
    return original(command, args, options);
  });
  await expect(tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })).rejects.toBe(
    teardownError
  );
});

it.each([
  'reused PID',
  'blank native start time',
  'wrong parent',
  'malformed parent',
  'cycle',
  'parent query failure',
])('rejects controller ancestry with %s and awaits stop before fallback', async failure => {
  const original = jest.mocked(spawn).getMockImplementation()!;
  jest.mocked(spawn).mockImplementation((file, args, options) => {
    if (
      file === 'ps' &&
      args[1] === String(CONTROLLER_PID) &&
      args.includes('lstart=') &&
      (failure === 'reused PID' || failure === 'blank native start time')
    ) {
      return Promise.resolve({
        stdout: failure === 'blank native start time' ? '' : 'a different native start time',
      }) as ReturnType<typeof spawn>;
    }
    if (file === 'ps' && args.includes('ppid=')) {
      if (failure === 'parent query failure') {
        return Promise.reject(new Error('ps failed')) as ReturnType<typeof spawn>;
      }
      const stdout =
        failure === 'wrong parent'
          ? '1'
          : failure === 'malformed parent'
            ? `1 node ${SCRIPT}`
            : failure === 'cycle'
              ? '10'
              : `${CONTROLLER_PID}`;
      return Promise.resolve({ stdout }) as ReturnType<typeof spawn>;
    }
    return original(file, args, options);
  });
  expect(await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })).toBeUndefined();
  expect(turtleFetch).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '@expo/simulator-launcher@latest', 'stop'],
    expect.anything()
  );
});

it('walks native parents to the recorded controller and verifies its start time', async () => {
  const original = jest.mocked(spawn).getMockImplementation()!;
  jest
    .mocked(spawn)
    .mockImplementation((file, args, options) =>
      file === 'ps' && args.includes('ppid=')
        ? (Promise.resolve({ stdout: args[1] === '10' ? '20' : `${CONTROLLER_PID}` }) as ReturnType<
            typeof spawn
          >)
        : original(file, args, options)
    );
  expect(await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })).toBeDefined();
  expect(spawn).toHaveBeenCalledWith('ps', ['-p', '10', '-o', 'ppid='], { stdio: 'pipe' });
  expect(spawn).toHaveBeenCalledWith('ps', ['-p', '20', '-o', 'ppid='], { stdio: 'pipe' });
  expect(spawn).toHaveBeenCalledWith('ps', ['-p', String(CONTROLLER_PID), '-o', 'lstart='], {
    stdio: 'pipe',
  });
});

it('captures all four preflight outputs through the real turtle-spawn wrapper', async () => {
  const realSpawn =
    jest.requireActual<typeof import('@expo/turtle-spawn')>('@expo/turtle-spawn').default;
  const original = jest.mocked(spawn).getMockImplementation()!;
  await writeAsync(path.join(stateDir, 'daemon.json'), {
    pid: 30,
    httpPort: 12345,
    token: 'agent-secret',
    version: '1.2.3',
    stateDir,
    processStartTime: CONTROLLER_START_TIME,
  });
  jest.mocked(spawn).mockImplementation((file, args, options) => {
    if (file !== '/usr/sbin/sysctl' && file !== 'ps') {
      return original(file, args, options);
    }
    const output =
      file === '/usr/sbin/sysctl'
        ? 'boot-1\n'
        : args.includes('lstart=')
          ? `${CONTROLLER_START_TIME}\n`
          : `${CONTROLLER_PID}\n`;
    // Execute only disposable Node children. Preserve options so inherited stdio cannot fake capture.
    return realSpawn(
      process.execPath,
      ['-e', `process.stdout.write(${JSON.stringify(output)})`],
      options
    );
  });
  const warm = await tryClaimWarmIosSessionAsync({ engine: 'agent-device', env, logger });
  expect(warm?.tools?.pid).toBe(30);
  const preflightCalls = jest
    .mocked(spawn)
    .mock.calls.filter(([file]) => file === '/usr/sbin/sysctl' || file === 'ps');
  expect(preflightCalls).toHaveLength(4);
  for (const [, , options] of preflightCalls) {
    expect(options).toEqual({ stdio: 'pipe' });
  }
  expect(logger.warn).not.toHaveBeenCalled();
});

it('rejects a valid-looking controller PID that is not an ancestor', async () => {
  await writeAsync(STATE, {
    status: 'ready',
    device: { udid: UDID, name: 'iPhone 17' },
    bootUuid: 'boot-1',
    controllerPid: CONTROLLER_PID + 1,
    controllerStartTime: CONTROLLER_START_TIME,
    agentDeviceStateDir: stateDir,
    argentEventLogPath: '/events.jsonl',
  });
  expect(await tryClaimWarmIosSessionAsync({ engine: 'serve-sim', env, logger })).toBeUndefined();
  expect(turtleFetch).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '@expo/simulator-launcher@latest', 'stop'],
    expect.anything()
  );
});

it('rejects Argent outside the recorded controller even when serve-sim has valid ancestry', async () => {
  await writeAsync(path.join(os.homedir(), '.argent/tool-server.json'), {
    pid: 40,
    port: 3201,
    token: 'argent-token',
    bundlePath: '/cache/argent/dist/cli.mjs',
    version: '1.2.3',
  });
  await writeAsync('/cache/argent/package.json', { version: '1.2.3' });
  const original = jest.mocked(spawn).getMockImplementation()!;
  jest
    .mocked(spawn)
    .mockImplementation((file, args, options) =>
      file === 'ps' && args[1] === '40' && args.includes('ppid=')
        ? (Promise.resolve({ stdout: '1' }) as ReturnType<typeof spawn>)
        : original(file, args, options)
    );
  expect(await tryClaimWarmIosSessionAsync({ engine: 'argent', env, logger })).toBeUndefined();
  expect(spawn).toHaveBeenCalledWith('ps', ['-p', '40', '-o', 'ppid='], { stdio: 'pipe' });
  expect(jest.mocked(turtleFetch).mock.calls.some(([url]) => url.endsWith('/tools'))).toBe(false);
  expect(spawn).toHaveBeenCalledWith(
    'bun',
    ['x', '@expo/simulator-launcher@latest', 'stop'],
    expect.anything()
  );
});
