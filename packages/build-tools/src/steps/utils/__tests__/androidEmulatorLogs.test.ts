import { type BuildStepGlobalContext } from '@expo/steps';
import { once } from 'node:events';
import fsPromises, {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { type CustomBuildContext } from '../../../customBuildContext';
import { type AndroidEmulatorLogSource } from '../../../utils/androidEmulatorLogSources';
import {
  collectAndroidEmulatorLogsAsync,
  getAndroidEmulatorLogCapture,
} from '../androidEmulatorLogs';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';

jest.mock('../deviceRunSessionArtifacts');
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

const ctx = {} as CustomBuildContext;
const upload = jest.mocked(uploadDeviceRunSessionArtifactAsync);
let directory: string;
let emulatorPath: string;
let logcatPath: string;
let global: BuildStepGlobalContext;
let logger: ReturnType<typeof createMockLogger>;
let uploadedContents: Map<string, string>;

beforeEach(async () => {
  global = {} as BuildStepGlobalContext;
  logger = createMockLogger();
  uploadedContents = new Map();
  directory = await mkdtemp(path.join(os.tmpdir(), 'android-log-collection-'));
  emulatorPath = path.join(directory, 'device-attempt-1-emulator.log');
  logcatPath = path.join(directory, 'device-attempt-1-logcat.log');
  upload.mockReset().mockImplementation(async (_ctx, { filename, openStream }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of openStream()) {
      chunks.push(Buffer.from(chunk));
    }
    uploadedContents.set(filename, Buffer.concat(chunks).toString());
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

async function captureLog(
  filePath: string,
  source: AndroidEmulatorLogSource,
  text: string,
  workflow = global
): Promise<void> {
  const capture = getAndroidEmulatorLogCapture(workflow, { DEVICE_RUN_SESSION_ID: 'session' });
  const input = Readable.from([Buffer.from(text)]);
  capture.attach(input, filePath, source);
  await once(input, 'end');
  await capture.finishFileAsync(filePath);
}

function collect(): Promise<void> {
  return collectAndroidEmulatorLogsAsync(ctx, {
    global,
    deviceRunSessionId: 'session',
    logger,
  });
}

it.each(['emulator-output', 'device-logcat'] as const)(
  'uploads the captured %s without collect-side configuration',
  async source => {
    const filePath = source === 'emulator-output' ? emulatorPath : logcatPath;
    await captureLog(filePath, source, 'selected output');
    await collect();
    expect([...uploadedContents.keys()]).toEqual([path.basename(filePath)]);
  }
);

it('keeps ordinary builds uncapped and simulator sessions bounded', () => {
  expect(getAndroidEmulatorLogCapture(global, {}).maxBytes).toBe(Infinity);
  expect(
    getAndroidEmulatorLogCapture({} as BuildStepGlobalContext, { DEVICE_RUN_SESSION_ID: 'session' })
      .maxBytes
  ).toBe(20 * 1024 * 1024);
});

it('uses captured source records and ignores files outside the capture inventory', async () => {
  const first = path.join(directory, 'first.txt');
  const second = path.join(directory, 'second.txt');
  await captureLog(first, 'emulator-output', 'host output');
  await captureLog(second, 'device-logcat', 'Android output');
  await captureLog(path.join(directory, 'retry.txt'), 'emulator-output', 'retry output');
  await writeFile(emulatorPath, 'not captured');
  const elsewhere = path.join(directory, 'elsewhere');
  await mkdir(elsewhere);
  await writeFile(path.join(elsewhere, 'other-emulator.log'), 'another job');
  await symlink(path.join(elsewhere, 'other-emulator.log'), logcatPath);
  await collect();

  expect([...uploadedContents.values()]).toEqual(['host output', 'Android output', 'retry output']);
  expect(upload).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      filename: 'first.txt',
      kind: 'simulator-log',
      metadata: expect.objectContaining({
        platform: 'android',
        source: 'emulator-output',
        scope: 'emulator-process',
        originalSizeBytes: 11,
        omittedBytes: 0,
        truncated: false,
      }),
      signal: expect.any(AbortSignal),
      attempts: 2,
    })
  );
  expect(upload).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      filename: 'second.txt',
      metadata: expect.objectContaining({ source: 'device-logcat', scope: 'device' }),
    })
  );
});

it('seals a live producer before upload and keeps retry bodies identical without copying files', async () => {
  const input = new PassThrough();
  const capture = getAndroidEmulatorLogCapture(global, { DEVICE_RUN_SESSION_ID: 'session' });
  capture.attach(input, emulatorPath, 'emulator-output');
  input.write('before');
  const contents: string[] = [];
  upload.mockImplementationOnce(async (_ctx, { size, openStream, metadata }) => {
    expect(size).toBe(6);
    expect(metadata).toEqual(expect.objectContaining({ originalSizeBytes: 6, truncated: false }));
    for (let attempt = 0; attempt < 2; attempt++) {
      input.write(' ignored after finalization');
      const chunks: Buffer[] = [];
      for await (const chunk of openStream()) {
        chunks.push(Buffer.from(chunk));
      }
      contents.push(Buffer.concat(chunks).toString());
    }
  });
  try {
    await collect();
    expect(contents).toEqual(['before', 'before']);
    expect(await readFile(emulatorPath, 'utf8')).toBe('before');
    expect(await readdir(directory)).toEqual([path.basename(emulatorPath)]);
    expect(input.readableFlowing).toBe(true);
    const late = new PassThrough();
    capture.attach(late, logcatPath, 'device-logcat');
    late.end('not captured');
    expect(late.readableFlowing).toBe(true);
    await expect(fsPromises.stat(logcatPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    input.end();
  }
});

it('continues after a failed file without repeating the collection', async () => {
  await captureLog(emulatorPath, 'emulator-output', 'host output');
  await captureLog(logcatPath, 'device-logcat', 'Android output');
  upload.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(collect()).resolves.toBeUndefined();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('other logs will continue')
  );
  await collect();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload.mock.calls[0][1].signal).not.toBe(upload.mock.calls[1][1].signal);
});

it('shares workflow capture and skips successful uploads on repeated or concurrent cleanup', async () => {
  expect(getAndroidEmulatorLogCapture(global, { DEVICE_RUN_SESSION_ID: 'session' })).toBe(
    getAndroidEmulatorLogCapture(global, { DEVICE_RUN_SESSION_ID: 'session' })
  );
  await captureLog(emulatorPath, 'emulator-output', 'host output');
  await Promise.all([collect(), collect()]);
  await collect();
  expect(upload).toHaveBeenCalledTimes(1);
});

it('uses a fresh 30 second budget for the next file after an upload times out', async () => {
  await captureLog(emulatorPath, 'emulator-output', 'host output');
  await captureLog(logcatPath, 'device-logcat', 'Android output');
  const controllers: AbortController[] = [];
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  upload.mockImplementationOnce(async (_ctx, { signal }) => {
    controllers[0].abort(new Error('upload timed out'));
    signal?.throwIfAborted();
  });
  await expect(collect()).resolves.toBeUndefined();
  expect(uploadedContents.get(path.basename(logcatPath))).toBe('Android output');
  expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
  expect(upload.mock.calls[1][1].signal?.aborted).toBe(false);
});

it('does not collect another workflow or empty files and continues after a captured file disappears', async () => {
  await captureLog(emulatorPath, 'emulator-output', 'other workflow', {} as BuildStepGlobalContext);
  await collect();
  expect(upload).not.toHaveBeenCalled();
  await captureLog(logcatPath, 'device-logcat', '');
  await captureLog(path.join(directory, 'missing.log'), 'emulator-output', 'removed');
  await rm(path.join(directory, 'missing.log'));
  await expect(collect()).resolves.toBeUndefined();
  expect(upload).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('missing.log')
  );
});

it('aborts on a genuine log file read error and continues with the other log', async () => {
  await captureLog(emulatorPath, 'emulator-output', 'host output');
  await captureLog(logcatPath, 'device-logcat', 'Android output');
  const readError = Object.assign(new Error('log read failed'), { code: 'EIO' });
  upload.mockImplementationOnce(async (_ctx, { openStream, signal }) => {
    const stream = openStream();
    await new Promise<void>(resolve => {
      stream.once('error', () => resolve());
      stream.destroy(readError);
    });
    expect(signal?.reason).toBe(readError);
    signal?.throwIfAborted();
  });
  await expect(collect()).resolves.toBeUndefined();
  expect(uploadedContents.get(path.basename(logcatPath))).toBe('Android output');
  expect(logger.warn).toHaveBeenCalledWith(
    { err: readError },
    expect.stringContaining('other logs will continue')
  );
});
