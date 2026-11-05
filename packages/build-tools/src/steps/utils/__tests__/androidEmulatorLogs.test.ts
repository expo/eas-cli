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
import { MAX_ANDROID_LOG_BYTES_PER_SOURCE } from '../../../utils/androidEmulatorLogCapture';
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

it.each([
  { env: {}, expectedBytes: 20 * 1024 * 1024 + 1 },
  { env: { DEVICE_RUN_SESSION_ID: 'session' }, expectedBytes: 20 * 1024 * 1024 },
])('retains $expectedBytes with workflow environment $env', async ({ env, expectedBytes }) => {
  const capture = getAndroidEmulatorLogCapture(global, env);
  const input = Readable.from([Buffer.alloc(20 * 1024 * 1024 + 1, 'x')]);
  capture.attach(input, emulatorPath, 'emulator-output');
  await once(input, 'end');
  await capture.finishAsync();
  expect((await fsPromises.stat(emulatorPath)).size).toBe(expectedBytes);
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

it('continues with the other log after a failed upload and never repeats the collection', async () => {
  await captureLog(emulatorPath, 'emulator-output', 'host output');
  await captureLog(logcatPath, 'device-logcat', 'Android output');
  upload.mockRejectedValueOnce(new Error('storage unavailable'));
  await Promise.all([collect(), collect()]);
  await collect();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(uploadedContents.get(path.basename(logcatPath))).toBe('Android output');
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('other logs will continue')
  );
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

it('does not collect another workflow and warns when a captured file disappears', async () => {
  await captureLog(emulatorPath, 'emulator-output', 'other workflow', {} as BuildStepGlobalContext);
  await collect();
  expect(upload).not.toHaveBeenCalled();
  await captureLog(path.join(directory, 'missing.log'), 'emulator-output', 'removed');
  await rm(path.join(directory, 'missing.log'));
  await expect(collect()).resolves.toBeUndefined();
  expect(upload).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('missing.log')
  );
});

it('uploads a truncated log with the retained size and omission metadata', async () => {
  const capture = getAndroidEmulatorLogCapture(global, { DEVICE_RUN_SESSION_ID: 'session' });
  const input = Readable.from([Buffer.alloc(MAX_ANDROID_LOG_BYTES_PER_SOURCE + 6, 'a')]);
  capture.attach(input, emulatorPath, 'emulator-output');
  await once(input, 'end');
  await collect();
  expect(upload).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      size: MAX_ANDROID_LOG_BYTES_PER_SOURCE,
      name: expect.stringContaining('truncated, 20 MiB retained'),
      metadata: expect.objectContaining({
        originalSizeBytes: MAX_ANDROID_LOG_BYTES_PER_SOURCE + 6,
        omittedBytes: 6,
        truncated: true,
      }),
    })
  );
  expect(uploadedContents.get(path.basename(emulatorPath))).toHaveLength(
    MAX_ANDROID_LOG_BYTES_PER_SOURCE
  );
});
