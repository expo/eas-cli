import { type Env } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
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
  IosSimulatorRecordingUtils.registerServeSimPackage(udid, '@expo/serve-sim@next');
  jest
    .spyOn(IosSimulatorUtils, 'getAvailableDevicesAsync')
    .mockResolvedValue([{ udid, name: 'iPhone 17 Pro', runtimeDisplayName: 'iOS 26.4' } as never]);
  jest.mocked(readServeSimServersAsync).mockReset();
  jest.mocked(spawn).mockReset();
});

afterEach(async () => {
  await IosSimulatorRecordingUtils.finishAsync({ logger });
  IosSimulatorRecordingUtils.unregisterServeSimPackage(udid, '@expo/serve-sim@next');
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
  expect(Sentry.capture).toHaveBeenCalled();
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
