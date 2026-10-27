import { type Env } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';

import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { IosSimulatorRecordingUtils } from '../IosSimulatorRecordingUtils';
import { readServeSimServersAsync } from '../serveSimMetricsRecorder';

jest.mock('@expo/turtle-spawn');
jest.mock('../serveSimMetricsRecorder');
jest.mock('../../../sentry');
jest.mock('node:timers/promises', () => ({
  setTimeout: (ms: number, value?: unknown, options?: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const abort = (): void => {
        clearTimeout(timer);
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener('abort', abort);
        resolve(value);
      }, ms);
      if (options?.signal?.aborted) {
        abort();
      } else {
        options?.signal?.addEventListener('abort', abort, { once: true });
      }
    }),
}));

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as bunyan;
const udid = '06B546AC-7B06-4BED-83DB-83603E8EB537';
let exit: () => void;
let child: ChildProcess;
let finishing: Promise<unknown> | undefined;

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  IosSimulatorRecordingUtils.useServeSimPackage('@expo/serve-sim@next');
  jest
    .spyOn(IosSimulatorUtils, 'getAvailableDevicesAsync')
    .mockResolvedValue([{ udid, name: 'iPhone 17 Pro', runtimeDisplayName: 'iOS 26.4' } as never]);
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([{ udid, url: 'http://127.0.0.1:43563', token: 'session-token' }]);
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  }) as unknown as ChildProcess;
  const done = new Promise<void>(resolve => {
    exit = resolve;
  });
  jest.mocked(spawn).mockReturnValue(Object.assign(done, { child }) as never);
  await IosSimulatorRecordingUtils.startAsync({ env: {} as Env, logger });
  for (let attempt = 0; attempt < 100 && jest.mocked(spawn).mock.calls.length === 0; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  expect(spawn).toHaveBeenCalledTimes(1);
  child.stderr?.emit('data', 'serve-sim:recording-started\n');
});

async function saveManifest(): Promise<void> {
  const directory = jest.mocked(spawn).mock.calls[0][1][6];
  await writeFile(`${directory}/session.json`, JSON.stringify({ recording: 'recording.mp4' }));
}

afterEach(async () => {
  if (jest.mocked(spawn).mock.calls.length) {
    await saveManifest();
  }
  exit();
  finishing ??= IosSimulatorRecordingUtils.finishAsync({ logger });
  await jest.advanceTimersByTimeAsync(1_000);
  await finishing;
  finishing = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.mocked(spawn).mockReset();
});

test('keeps the recorder alive through a 120-second stop request and 300-second reconciliation', async () => {
  finishing = IosSimulatorRecordingUtils.finishAsync({ logger });
  await jest.advanceTimersByTimeAsync(0);
  expect(child.kill).toHaveBeenCalledWith('SIGINT');

  await jest.advanceTimersByTimeAsync(420_000);
  expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
  await saveManifest();
  exit();
  await jest.advanceTimersByTimeAsync(0);
  expect(await finishing).toHaveLength(1);
  expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
});

test('force-kills an unresponsive started recorder after the bounded shutdown allowance', async () => {
  jest.mocked(child.kill).mockImplementation(signal => {
    if (signal === 'SIGKILL') {
      exit();
    }
    return true;
  });
  finishing = IosSimulatorRecordingUtils.finishAsync({ logger });
  await jest.advanceTimersByTimeAsync(429_999);
  expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
  await saveManifest();
  await jest.advanceTimersByTimeAsync(1);
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  expect(await finishing).toHaveLength(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('did not finish within 430 seconds')
  );
});

test('retains a manifest saved after a 180-second lease and 120-second finalization', async () => {
  exit();
  finishing = IosSimulatorRecordingUtils.finishAsync({ logger });
  await jest.advanceTimersByTimeAsync(299_999);
  await saveManifest();
  await jest.advanceTimersByTimeAsync(1_001);
  expect(await finishing).toHaveLength(1);
  expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
});
