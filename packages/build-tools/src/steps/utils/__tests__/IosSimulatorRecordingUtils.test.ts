import { type Env } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { setTimeout } from 'node:timers/promises';

import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { Sentry } from '../../../sentry';
import { IosSimulatorRecordingUtils } from '../IosSimulatorRecordingUtils';
import { readServeSimServersAsync } from '../serveSimMetricsRecorder';

jest.mock('@expo/turtle-spawn');
jest.mock('../serveSimMetricsRecorder');
jest.mock('../../../sentry');

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as bunyan;
const env = {} as Env;
const udid = '06B546AC-7B06-4BED-83DB-83603E8EB537';

beforeEach(() => {
  IosSimulatorRecordingUtils.useServeSimPackage('@expo/serve-sim@next');
  jest
    .spyOn(IosSimulatorUtils, 'getAvailableDevicesAsync')
    .mockResolvedValue([{ udid, name: 'iPhone 17 Pro', runtimeDisplayName: 'iOS 26.4' } as never]);
  jest.mocked(readServeSimServersAsync).mockReset();
  jest.mocked(spawn).mockReset();
});

afterEach(async () => {
  await IosSimulatorRecordingUtils.finishAsync({ logger });
  jest.restoreAllMocks();
});

async function waitForRecorderSpawnAsync(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (jest.mocked(spawn).mock.calls.length > 0) {
      return;
    }
    await setTimeout(10);
  }
  throw new Error('serve-sim recorder did not start');
}

// A recorder the test controls: `exit` ends it cleanly, `fail` ends it with an error.
function mockRecorder({ kill }: { kill?: (signal: NodeJS.Signals) => void } = {}): {
  child: ChildProcess;
  exit: () => void;
  fail: (error: Error) => void;
} {
  let exit: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn((signal: NodeJS.Signals) => {
      kill?.(signal);
      return true;
    }),
  }) as unknown as ChildProcess;
  const done = new Promise<void>((resolve, reject) => {
    exit = resolve;
    fail = reject;
  });
  jest.mocked(spawn).mockReturnValue(Object.assign(done, { child }) as never);
  return { child, exit: () => exit(), fail: error => fail(error) };
}

function mockFailingRecorder(): void {
  jest.mocked(spawn).mockImplementation((_command, args) => {
    void writeFile(`${args[6]}/session.json`, JSON.stringify({ recording: 'recording.mp4' }));
    return Object.assign(Promise.reject(new Error('recorder exited')), {
      child: {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: jest.fn(),
      },
    }) as never;
  });
}

test('waits for a token-gated serve-sim session before starting a recorder', async () => {
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563' }]);

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await IosSimulatorRecordingUtils.finishAsync({ logger });

  expect(jest.mocked(spawn)).not.toHaveBeenCalled();
});

test('starts serve-sim record-video and returns only a finalized recording', async () => {
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  let resolveProcess: () => void = () => {};
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr,
    kill: jest.fn(),
  }) as unknown as ChildProcess;
  const processPromise = Object.assign(
    new Promise<void>(resolve => {
      resolveProcess = resolve;
    }),
    {
      child,
    }
  );
  jest.mocked(spawn).mockReturnValue(processPromise as never);

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  const [command, args, options] = jest.mocked(spawn).mock.calls[0];
  expect(command).toBe('npx');
  expect(args.slice(0, 5)).toEqual([
    '--yes',
    '@expo/serve-sim@next',
    'record-video',
    '--udid',
    udid,
  ]);
  expect(args[5]).toBe('--output');
  expect(args).not.toContain('--segment-duration');
  expect(options?.detached).toBe(true);

  const outputDirectory = args[6];
  jest.mocked(child.kill).mockImplementation(() => {
    resolveProcess();
    void setTimeout(20).then(() =>
      writeFile(`${outputDirectory}/session.json`, JSON.stringify({ recording: 'recording.mp4' }))
    );
    return true;
  });
  const finishing = IosSimulatorRecordingUtils.finishAsync({ logger });
  await setTimeout(20);
  expect(child.kill).not.toHaveBeenCalled();
  stderr.write('serve-sim:recording-started\n');
  stderr.write('x'.repeat(17_000));
  const recordings = await finishing;

  expect(child.kill).toHaveBeenCalledWith('SIGINT');
  expect(recordings).toEqual([
    {
      udid,
      deviceName: 'iPhone 17 Pro',
      runtimeDisplayName: 'iOS 26.4',
      directory: outputDirectory,
    },
  ]);
});

test('reports a started recording that ends without a manifest to Sentry', async () => {
  let currentTime = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  let exitRecorder: () => void = () => {};
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  }) as unknown as ChildProcess;
  jest.mocked(spawn).mockReturnValue(
    Object.assign(
      new Promise<void>(resolve => {
        exitRecorder = resolve;
      }),
      { child }
    ) as never
  );

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  child.stderr?.emit('data', 'serve-sim:recording-started\n');
  child.stderr?.emit('data', 'GET http://127.0.0.1:43563/record?token=session-token failed\n');
  exitRecorder();
  await setTimeout(50);
  currentTime += 31_000;
  await setTimeout(1_100);

  expect(Sentry.capture).toHaveBeenCalledWith(
    'iOS Simulator screen recording ended without a manifest',
    { level: 'warning', extras: { deviceName: 'iPhone 17 Pro' } }
  );
  expect(JSON.stringify(jest.mocked(Sentry.capture).mock.calls)).not.toContain('session-token');
});

test('says when a recorder never reported its start before it is stopped', async () => {
  let currentTime = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  let exitRecorder: () => void = () => {};
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(() => {
      exitRecorder();
      return true;
    }),
  }) as unknown as ChildProcess;
  jest.mocked(spawn).mockReturnValue(
    Object.assign(
      new Promise<void>(resolve => {
        exitRecorder = resolve;
      }),
      { child }
    ) as never
  );

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  const finishing = IosSimulatorRecordingUtils.finishAsync({ logger });
  await setTimeout(50);
  currentTime += 61_000;
  await setTimeout(200);
  currentTime += 31_000;

  expect(await finishing).toEqual([]);
  expect(child.kill).toHaveBeenCalledWith('SIGINT');
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    'Screen recording for iPhone 17 Pro did not report its start within 60 seconds and will be stopped.'
  );
});

test('retries after a failed recorder when the serve-sim session token changes', async () => {
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValueOnce([{ udid, url: 'http://127.0.0.1:43563', token: 'old-token' }])
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'new-token' }]);
  mockFailingRecorder();

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  await setTimeout(2_100);

  expect(spawn).toHaveBeenCalledTimes(2);
  expect(Sentry.capture).not.toHaveBeenCalled();
  expect(await IosSimulatorRecordingUtils.finishAsync({ logger })).toEqual([]);
  expect(Sentry.capture).toHaveBeenCalledTimes(1);
  expect(Sentry.capture).toHaveBeenCalledWith(
    'iOS Simulator screen recording failed on every attempt',
    expect.objectContaining({ level: 'warning', extras: { attempts: 2 } })
  );
});

test('reports a device that failed and then shut down', async () => {
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  mockFailingRecorder();

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  jest.mocked(IosSimulatorUtils.getAvailableDevicesAsync).mockResolvedValue([]);
  await setTimeout(2_100);

  expect(await IosSimulatorRecordingUtils.finishAsync({ logger })).toEqual([]);
  expect(Sentry.capture).toHaveBeenCalledWith(
    'iOS Simulator screen recording failed on every attempt',
    expect.objectContaining({ extras: { attempts: 1 } })
  );
});

test('retries after the server lease expires without a token change', async () => {
  const startTime = Date.now();
  let currentTime = startTime;
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  mockFailingRecorder();

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  currentTime += 26_000;
  await setTimeout(2_100);

  expect(spawn).toHaveBeenCalledTimes(2);
});

test('does not start a second recording for a server token after a late manifest', async () => {
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  jest.mocked(spawn).mockImplementation((_command, args) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: jest.fn(),
    }) as unknown as ChildProcess;
    void setTimeout(20).then(() =>
      writeFile(`${args[6]}/session.json`, JSON.stringify({ recording: 'recording.mp4' }))
    );
    return Object.assign(Promise.resolve(), { child }) as never;
  });

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  await setTimeout(2_100);

  expect(spawn).toHaveBeenCalledTimes(1);
  expect(await IosSimulatorRecordingUtils.finishAsync({ logger })).toHaveLength(1);
});

test('keeps a recorder active after its package-manager wrapper exits', async () => {
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  let groupRunning = true;
  const originalKill = process.kill.bind(process);
  const signalGroup = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid !== -4321) {
      return originalKill(pid, signal);
    }
    if (signal === 0) {
      if (groupRunning) {
        return true;
      }
      throw Object.assign(new Error('No such process group'), { code: 'ESRCH' });
    }
    if (signal === 'SIGINT') {
      void setTimeout(20).then(async () => {
        const args = jest.mocked(spawn).mock.calls[0][1];
        await writeFile(`${args[6]}/session.json`, JSON.stringify({ recording: 'recording.mp4' }));
        groupRunning = false;
      });
      return true;
    }
    throw new Error(`Unexpected signal: ${signal}`);
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 4321,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  }) as unknown as ChildProcess;
  jest.mocked(spawn).mockReturnValue(Object.assign(Promise.resolve(), { child }) as never);

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  child.stderr?.emit('data', 'serve-sim:recording-started\n');
  await setTimeout(2_100);
  expect(spawn).toHaveBeenCalledTimes(1);

  const recordings = await IosSimulatorRecordingUtils.finishAsync({ logger });
  expect(signalGroup).toHaveBeenCalledWith(-4321, 'SIGINT');
  expect(child.kill).not.toHaveBeenCalled();
  expect(recordings).toHaveLength(1);
});

test('does not signal a recorder that exits before it reports its start', async () => {
  let currentTime = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  const recorder = mockRecorder();

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  const finishing = IosSimulatorRecordingUtils.finishAsync({ logger });
  await setTimeout(50);
  recorder.exit();
  await setTimeout(50);
  // Past the manifest wait, so the recorder's completion settles.
  currentTime += 31_000;

  expect(await finishing).toEqual([]);
  expect(recorder.child.kill).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    'Screen recording for iPhone 17 Pro exited before it started; it will be retried.'
  );
});

test('kills a recorder that ignores SIGINT and reports one that survives SIGKILL', async () => {
  let currentTime = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  const recorder = mockRecorder();

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  recorder.child.stderr?.emit('data', 'GET /record?token=session-token\n');
  const finishing = IosSimulatorRecordingUtils.finishAsync({ logger });
  await setTimeout(50);
  currentTime += 61_000;

  expect(await finishing).toEqual([]);
  expect(recorder.child.kill).toHaveBeenCalledWith('SIGINT');
  expect(recorder.child.kill).toHaveBeenCalledWith('SIGKILL');
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining(
      'Screen recording for iPhone 17 Pro did not stop within 5 seconds of SIGINT and will be killed.'
    )
  );
  expect(Sentry.capture).toHaveBeenCalledWith(
    'iOS Simulator recording process for iPhone 17 Pro did not exit after SIGKILL.'
  );
  expect(JSON.stringify(jest.mocked(Sentry.capture).mock.calls)).not.toContain('session-token');
}, 20_000);

test('reports a finalized recording whose manifest is gone at finish', async () => {
  let currentTime = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  const recorder = mockRecorder();

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  const manifest = `${jest.mocked(spawn).mock.calls[0][1][6]}/session.json`;
  recorder.child.stderr?.emit('data', 'serve-sim:recording-started\n');
  await writeFile(manifest, JSON.stringify({ recording: 'recording.mp4' }));
  recorder.exit();
  await setTimeout(100);
  await rm(manifest);
  const finishing = IosSimulatorRecordingUtils.finishAsync({ logger });
  await setTimeout(50);
  currentTime += 31_000;

  expect(await finishing).toEqual([]);
  expect(Sentry.capture).toHaveBeenCalledWith(
    'iOS Simulator screen recording ended without a manifest',
    { level: 'warning', extras: { deviceName: 'iPhone 17 Pro' } }
  );
});

test('reports a started recorder that fails without a manifest', async () => {
  let currentTime = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  const recorder = mockRecorder();

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  await waitForRecorderSpawnAsync();
  recorder.child.stderr?.emit('data', 'serve-sim:recording-started\n');
  recorder.fail(new Error('record-video exited with code 1'));
  await setTimeout(50);
  currentTime += 31_000;
  await setTimeout(1_100);

  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    'Screen recording process failed for iPhone 17 Pro.'
  );
  expect(Sentry.capture).toHaveBeenCalledWith(
    'iOS Simulator screen recording ended without a manifest',
    expect.objectContaining({ level: 'warning' })
  );
});

test('records every booted device with the first serve-sim package', async () => {
  let currentTime = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
  const secondUdid = '1C17CD51-5926-4838-951B-6D941C7BEDFF';
  IosSimulatorRecordingUtils.useServeSimPackage('@expo/serve-sim@later');
  jest
    .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
    .mockResolvedValue([
      { udid, name: 'iPhone 17 Pro', runtimeDisplayName: 'iOS 26.4' } as never,
      { udid: secondUdid, name: 'iPhone 17', runtimeDisplayName: 'iOS 26.4' } as never,
    ]);
  jest.mocked(readServeSimServersAsync).mockResolvedValue([
    { udid, url: 'http://127.0.0.1:43563', token: 'first-token' },
    { udid: secondUdid, url: 'http://127.0.0.1:43563', token: 'second-token' },
  ]);
  const recorder = mockRecorder();

  await IosSimulatorRecordingUtils.startAsync({ env, logger });
  for (let attempt = 0; attempt < 50 && jest.mocked(spawn).mock.calls.length < 2; attempt++) {
    await setTimeout(10);
  }

  const calls = jest.mocked(spawn).mock.calls.map(([, args]) => args);
  expect(calls.map(args => args[4]).sort()).toEqual([udid, secondUdid].sort());
  expect(calls.every(args => args[1] === '@expo/serve-sim@next')).toBe(true);

  recorder.exit();
  await setTimeout(50);
  currentTime += 31_000;
  await IosSimulatorRecordingUtils.finishAsync({ logger });
});
