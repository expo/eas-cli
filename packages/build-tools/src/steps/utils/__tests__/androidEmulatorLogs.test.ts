import { type BuildStepGlobalContext } from '@expo/steps';
import fs from 'node:fs';
import fsPromises, { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { type CustomBuildContext } from '../../../customBuildContext';
import {
  collectAndroidEmulatorLogsAsync,
  registerAndroidEmulatorLogDirectory,
} from '../androidEmulatorLogs';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';

jest.mock('../deviceRunSessionArtifacts');

const ctx = {} as CustomBuildContext;
const directory = path.join(os.tmpdir(), 'android-logs');
const emulatorPath = path.join(directory, 'device-attempt-1-emulator.log');
const logcatPath = path.join(directory, 'device-attempt-1-logcat.log');
const upload = jest.mocked(uploadDeviceRunSessionArtifactAsync);
let global: BuildStepGlobalContext;
let logger: ReturnType<typeof createMockLogger>;
let uploadedContents: Map<string, string>;

beforeEach(async () => {
  global = {} as BuildStepGlobalContext;
  logger = createMockLogger();
  uploadedContents = new Map();
  await mkdir(directory, { recursive: true });
  upload.mockReset().mockImplementation(async (_ctx, { filename, openStream }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of openStream()) {
      chunks.push(Buffer.from(chunk));
    }
    uploadedContents.set(filename, Buffer.concat(chunks).toString());
  });
});

function collect(maxBytes?: number): Promise<void> {
  return collectAndroidEmulatorLogsAsync(ctx, {
    global,
    deviceRunSessionId: 'session',
    logger,
    maxBytes,
  });
}

it('uploads both logs for every attempt from registered directories only', async () => {
  await writeFile(emulatorPath, 'host output');
  await writeFile(logcatPath, 'Android output');
  await writeFile(path.join(directory, 'device-attempt-2-emulator.log'), 'retry output');
  await writeFile(path.join(directory, 'unrelated.txt'), 'not a log');
  const elsewhere = path.join(os.tmpdir(), 'unregistered');
  await mkdir(elsewhere);
  await writeFile(path.join(elsewhere, 'other-emulator.log'), 'another job');
  await symlink(
    path.join(elsewhere, 'other-emulator.log'),
    path.join(directory, 'link-logcat.log')
  );
  registerAndroidEmulatorLogDirectory(global, directory);
  await collect();

  expect([...uploadedContents.values()]).toEqual(['host output', 'Android output', 'retry output']);
  expect(upload).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      filename: 'device-attempt-1-emulator.log',
      kind: 'simulator-log',
      metadata: expect.objectContaining({
        platform: 'android',
        source: 'emulator-output',
        scope: 'emulator-process',
        truncated: false,
      }),
      signal: expect.any(AbortSignal),
      attempts: 2,
    })
  );
  expect(upload).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      filename: 'device-attempt-1-logcat.log',
      metadata: expect.objectContaining({ source: 'device-logcat', scope: 'device' }),
    })
  );
  expect(await readdir(os.tmpdir())).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/^eas-android-log-snapshot-/)])
  );
});

it('keeps the latest bytes and records truncation', async () => {
  await writeFile(emulatorPath, 'old output\ncrash\n');
  registerAndroidEmulatorLogDirectory(global, directory);
  await collect(6);
  expect(uploadedContents.get(path.basename(emulatorPath))).toBe('crash\n');
  expect(upload).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      size: 6,
      name: expect.stringContaining('truncated, 6 bytes retained'),
      metadata: expect.objectContaining({
        originalSizeBytes: 17,
        omittedBytes: 11,
        truncated: true,
      }),
    })
  );
  expect(await readFile(emulatorPath, 'utf8')).toBe('old output\ncrash\n');
});

it('fixes the snapshot range before append and keeps upload retries identical', async () => {
  await writeFile(emulatorPath, 'before');
  registerAndroidEmulatorLogDirectory(global, directory);
  const createReadStream = fs.createReadStream;
  const read = jest.spyOn(fs, 'createReadStream').mockImplementationOnce((filePath, options) => {
    fs.appendFileSync(emulatorPath, ' during snapshot');
    return createReadStream(filePath, options);
  });
  const contents: string[] = [];
  upload.mockImplementationOnce(async (_ctx, { size, openStream }) => {
    expect(size).toBe(6);
    for (let attempt = 0; attempt < 2; attempt++) {
      await writeFile(emulatorPath, 'rewritten after snapshot');
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
  } finally {
    read.mockRestore();
  }
});

it('continues after a failed upload and retries only unsuccessful files on another collection', async () => {
  await writeFile(emulatorPath, 'host output');
  await writeFile(logcatPath, 'Android output');
  registerAndroidEmulatorLogDirectory(global, directory);
  upload.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(collect()).resolves.toBeUndefined();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('other logs will continue')
  );
  await collect();
  expect(upload).toHaveBeenCalledTimes(3);
  expect(upload.mock.calls[2][1].filename).toBe(path.basename(emulatorPath));
  expect(upload.mock.calls[0][1].signal).not.toBe(upload.mock.calls[1][1].signal);
});

it('shares concurrent collection and skips successful uploads on repeated cleanup', async () => {
  await writeFile(emulatorPath, 'host output');
  registerAndroidEmulatorLogDirectory(global, directory);
  registerAndroidEmulatorLogDirectory(global, directory);
  await Promise.all([collect(), collect()]);
  await collect();
  expect(upload).toHaveBeenCalledTimes(1);
});

it('keeps successful uploads deduplicated when snapshot cleanup fails', async () => {
  await writeFile(emulatorPath, 'host output');
  registerAndroidEmulatorLogDirectory(global, directory);
  const open = fsPromises.open;
  const openFile = jest.spyOn(fsPromises, 'open').mockImplementationOnce(async (...args) => {
    const file = await open(...args);
    const close = file.close.bind(file);
    file.close = async () => {
      await close();
      throw new Error('close failed');
    };
    return file;
  });
  const remove = jest.spyOn(fsPromises, 'rm').mockRejectedValueOnce(new Error('remove failed'));
  try {
    await expect(collect()).resolves.toBeUndefined();
    await collect();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Could not close')
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Could not remove')
    );
  } finally {
    openFile.mockRestore();
    remove.mockRestore();
  }
});

it('uses a fresh 30 second budget for the next file after an upload times out', async () => {
  await writeFile(emulatorPath, 'host output');
  await writeFile(logcatPath, 'Android output');
  registerAndroidEmulatorLogDirectory(global, directory);
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
  try {
    await expect(collect()).resolves.toBeUndefined();
    expect(uploadedContents.get(path.basename(logcatPath))).toBe('Android output');
    expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
    expect(upload.mock.calls[1][1].signal?.aborted).toBe(false);
  } finally {
    timeout.mockRestore();
  }
});

it('does not collect another workflow or empty files and tolerates missing directories', async () => {
  registerAndroidEmulatorLogDirectory({} as BuildStepGlobalContext, directory);
  await writeFile(emulatorPath, 'other workflow');
  await collect();
  expect(upload).not.toHaveBeenCalled();
  await writeFile(emulatorPath, '');
  registerAndroidEmulatorLogDirectory(global, path.join(os.tmpdir(), 'missing'));
  registerAndroidEmulatorLogDirectory(global, directory);
  await expect(collect()).resolves.toBeUndefined();
  expect(upload).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining('Could not read')
  );
});

it('handles a snapshot read failure and still uploads the other log', async () => {
  await writeFile(emulatorPath, 'host output');
  await writeFile(logcatPath, 'Android output');
  registerAndroidEmulatorLogDirectory(global, directory);
  const createReadStream = fs.createReadStream;
  const read = jest.spyOn(fs, 'createReadStream').mockImplementationOnce((filePath, options) => {
    const stream = createReadStream(filePath, options);
    stream.destroy(new Error('source read failed'));
    return stream;
  });
  try {
    await expect(collect()).resolves.toBeUndefined();
    expect(uploadedContents.get(path.basename(logcatPath))).toBe('Android output');
    expect(upload).toHaveBeenCalledTimes(1);
  } finally {
    read.mockRestore();
  }
});

it('aborts an upload on a genuine snapshot file read error and continues with the other log', async () => {
  await writeFile(emulatorPath, 'host output');
  await writeFile(logcatPath, 'Android output');
  registerAndroidEmulatorLogDirectory(global, directory);
  const readError = Object.assign(new Error('snapshot read failed'), { code: 'EIO' });
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
