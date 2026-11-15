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
import {
  ALL_ANDROID_EMULATOR_LOG_SOURCES,
  type AndroidEmulatorLogSource,
} from '../../../utils/androidEmulatorLogSources';
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
const sessionEnv = { DEVICE_RUN_SESSION_ID: 'session' };
const upload = jest.mocked(uploadDeviceRunSessionArtifactAsync);
let directory: string;
let emulatorPath: string;
let logcatPath: string;
let emulatorRing: string;
let logcatRing: string;
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
  emulatorRing = path.join(directory, 'emulator-output.log');
  logcatRing = path.join(directory, 'device-logcat.log');
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

/** `==== <launch> <ISO time> ====\n` precedes the first output of a launch. */
const MARKER = String.raw`==== \S+ \S+ ====\n`;

async function captureLaunch(
  filePath: string,
  source: AndroidEmulatorLogSource,
  text: string,
  workflow = global
): Promise<void> {
  const capture = getAndroidEmulatorLogCapture(
    workflow,
    sessionEnv,
    ALL_ANDROID_EMULATOR_LOG_SOURCES
  );
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
  { env: {}, file: 'device-attempt-1-emulator.log', expectedBytes: 20 * 1024 * 1024 + 1 },
  { env: sessionEnv, file: 'emulator-output.log', expectedBytes: 20 * 1024 * 1024 },
])(
  'retains $expectedBytes in $file with workflow environment $env',
  async ({ env, file, expectedBytes }) => {
    const capture = getAndroidEmulatorLogCapture(global, env, ALL_ANDROID_EMULATOR_LOG_SOURCES);
    const input = Readable.from([Buffer.alloc(20 * 1024 * 1024 + 1, 'x')]);
    capture.attach(input, emulatorPath, 'emulator-output');
    await once(input, 'end');
    await capture.finishAsync();
    expect((await fsPromises.stat(path.join(directory, file))).size).toBe(expectedBytes);
  }
);

it('uploads one artifact per source and ignores files outside the capture inventory', async () => {
  await captureLaunch(emulatorPath, 'emulator-output', 'host output');
  await captureLaunch(logcatPath, 'device-logcat', 'Android output');
  await captureLaunch(
    path.join(directory, 'retry-emulator.log'),
    'emulator-output',
    'retry output'
  );
  await writeFile(emulatorPath, 'not captured');
  const elsewhere = path.join(directory, 'elsewhere');
  await mkdir(elsewhere);
  await writeFile(path.join(elsewhere, 'other-emulator.log'), 'another job');
  await symlink(path.join(elsewhere, 'other-emulator.log'), logcatPath);
  await collect();

  expect([...uploadedContents.keys()]).toEqual(['emulator-output.log', 'device-logcat.log']);
  expect(uploadedContents.get('emulator-output.log')).toMatch(
    new RegExp(`^${MARKER}host output\\n${MARKER}retry output$`)
  );
  expect(uploadedContents.get('device-logcat.log')).toMatch(
    new RegExp(`^${MARKER}Android output$`)
  );
  expect(upload).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      filename: 'emulator-output.log',
      kind: 'simulator-log',
      metadata: expect.objectContaining({
        platform: 'android',
        source: 'emulator-output',
        scope: 'emulator-process',
        originalSizeBytes: uploadedContents.get('emulator-output.log')?.length,
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
      filename: 'device-logcat.log',
      metadata: expect.objectContaining({ source: 'device-logcat', scope: 'device' }),
    })
  );
});

it('seals a live producer before upload and keeps retry bodies identical without copying files', async () => {
  const input = new PassThrough();
  const capture = getAndroidEmulatorLogCapture(
    global,
    sessionEnv,
    ALL_ANDROID_EMULATOR_LOG_SOURCES
  );
  capture.attach(input, emulatorPath, 'emulator-output');
  input.write('before');
  const contents: string[] = [];
  upload.mockImplementationOnce(async (_ctx, { size, openStream, metadata }) => {
    expect(metadata).toEqual(
      expect.objectContaining({ originalSizeBytes: size, truncated: false })
    );
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
    expect(contents).toHaveLength(2);
    expect(contents[0]).toMatch(new RegExp(`^${MARKER}before$`));
    expect(contents[1]).toBe(contents[0]);
    expect(await readFile(emulatorRing, 'utf8')).toBe(contents[0]);
    expect(await readdir(directory)).toEqual(['emulator-output.log']);
    expect(input.readableFlowing).toBe(true);
    const late = new PassThrough();
    capture.attach(late, logcatPath, 'device-logcat');
    late.end('not captured');
    expect(late.readableFlowing).toBe(true);
    await expect(fsPromises.stat(logcatRing)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    input.end();
  }
});

it('continues with the other log after a failed upload and never repeats the collection', async () => {
  await captureLaunch(emulatorPath, 'emulator-output', 'host output');
  await captureLaunch(logcatPath, 'device-logcat', 'Android output');
  upload.mockRejectedValueOnce(new Error('storage unavailable'));
  await Promise.all([collect(), collect()]);
  await collect();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(uploadedContents.get('device-logcat.log')).toMatch(/Android output$/);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('other logs will continue')
  );
});

it('uses a fresh 30 second budget for the next file after an upload times out', async () => {
  await captureLaunch(emulatorPath, 'emulator-output', 'host output');
  await captureLaunch(logcatPath, 'device-logcat', 'Android output');
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
  expect(uploadedContents.get('device-logcat.log')).toMatch(/Android output$/);
  expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
  expect(upload.mock.calls[1][1].signal?.aborted).toBe(false);
});

it('does not collect another workflow and warns when a captured file disappears', async () => {
  const otherWorkflow = {} as BuildStepGlobalContext;
  await captureLaunch(emulatorPath, 'emulator-output', 'other workflow', otherWorkflow);
  await collect();
  expect(upload).not.toHaveBeenCalled();
  await getAndroidEmulatorLogCapture(otherWorkflow, sessionEnv, []).finishAsync();
  await captureLaunch(path.join(directory, 'missing-emulator.log'), 'emulator-output', 'removed');
  await rm(emulatorRing);
  await expect(collect()).resolves.toBeUndefined();
  expect(upload).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('emulator-output.log')
  );
});

it('uploads the tail of a truncated log with the retained size and omission metadata', async () => {
  const capture = getAndroidEmulatorLogCapture(
    global,
    sessionEnv,
    ALL_ANDROID_EMULATOR_LOG_SOURCES
  );
  const input = Readable.from([
    Buffer.concat([Buffer.from('head: '), Buffer.alloc(MAX_ANDROID_LOG_BYTES_PER_SOURCE, 'b')]),
  ]);
  capture.attach(input, emulatorPath, 'emulator-output');
  await once(input, 'end');
  await collect();
  const uploaded = uploadedContents.get('emulator-output.log');
  expect(uploaded).toHaveLength(MAX_ANDROID_LOG_BYTES_PER_SOURCE);
  expect(uploaded).not.toContain('head');
  expect(uploaded).not.toContain('====');
  const [, call] = upload.mock.calls[0];
  const { originalSizeBytes } = call.metadata as { originalSizeBytes: number };
  const omitted = originalSizeBytes - MAX_ANDROID_LOG_BYTES_PER_SOURCE;
  expect(omitted).toBeGreaterThanOrEqual(6);
  expect(call).toEqual(
    expect.objectContaining({
      size: MAX_ANDROID_LOG_BYTES_PER_SOURCE,
      name: expect.stringContaining('truncated, last 20.0 MB retained'),
      metadata: expect.objectContaining({ omittedBytes: omitted, truncated: true }),
    })
  );
});
