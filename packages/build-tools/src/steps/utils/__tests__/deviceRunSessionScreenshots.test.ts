import type { bunyan } from '@expo/logger';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { lstat, mkdtemp, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import {
  startDeviceRunSessionScreenshotsAsync,
  uploadDeviceRunSessionScreenshotsAsync,
} from '../deviceRunSessionScreenshots';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('../../../sentry');
const ctx = {} as CustomBuildContext;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const options = { deviceRunSessionId: 'session-id', logger };
let directory: string;
let uploaded: Buffer[];
let failedUploads: Map<string, { attempts: number; lastError: Error }>;

beforeEach(async () => {
  jest.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), 'screenshots-test-'));
  uploaded = [];
  failedUploads = new Map();
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, { stream }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    uploaded.push(Buffer.concat(chunks));
  });
});
afterEach(async () => {
  for (const [, { stream }] of jest.mocked(uploadDeviceRunSessionArtifactAsync).mock.calls) {
    stream.destroy();
  }
  await rm(directory, { recursive: true, force: true });
});
const flush = () =>
  uploadDeviceRunSessionScreenshotsAsync(ctx, {
    ...options,
    directory,
    failedUploads,
    signal: new AbortController().signal,
  });

it('uploads completed captures with their bytes and stable IDs, ignoring partial files and symlinks', async () => {
  const filename = 'screenshot-2026-09-24T08-45-59-123Z-ffffffffffff.png';
  // Sorts before the real file, so following the link would upload it before the target is gone.
  const link = 'screenshot-2026-09-24T08-45-59-123Z-000000000000.png';
  await writeFile(path.join(directory, filename), 'png-content');
  await writeFile(path.join(directory, `${filename}.tmp`), 'partial');
  await symlink(path.join(directory, filename), path.join(directory, link));
  await flush();
  await flush();
  expect(uploaded).toEqual([Buffer.from('png-content')]);
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      deviceRunSessionId: 'session-id',
      artifactId: filename.slice(0, -4),
      name: 'Screenshot 2026-09-24 08:45:59 UTC',
      filename: 'screenshot-2026-09-24T08-45-59-123Z.png',
      kind: 'screenshot',
      size: 11,
      metadata: { __eas_type: 'screenshot' },
    })
  );
  expect(await readdir(directory)).not.toContain(filename);
  expect((await lstat(path.join(directory, link))).isSymbolicLink()).toBe(true);
});

it('uploads captures that never failed first, oldest first, before retrying failed ones', async () => {
  const failed = 'screenshot-2026-09-24T08-45-00-000Z-aaaaaaaaaaaa.png';
  const newer = 'screenshot-2026-09-24T08-45-59-123Z-bbbbbbbbbbbb.png';
  const older = 'screenshot-2026-09-24T08-45-30-000Z-cccccccccccc.png';
  for (const name of [newer, failed, older]) {
    await writeFile(path.join(directory, name), name);
  }
  failedUploads.set(failed, { attempts: 1, lastError: new Error('stalled') });
  await flush();
  expect(
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mock.calls.map(([, { artifactId }]) => artifactId)
  ).toEqual([older, newer, failed].map(name => name.slice(0, -4)));
});

it('keeps failed uploads and retries the same artifact ID, logging the failed attempt count', async () => {
  const filename = `screenshot-2026-09-24T08-45-59-123Z-${randomBytes(6).toString('hex')}.png`;
  await writeFile(path.join(directory, filename), 'png');
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementationOnce(async () => {
    throw new Error('offline');
  });
  await flush();
  expect(await readdir(directory)).toContain(filename);
  await flush();
  expect(uploaded).toEqual([Buffer.from('png')]);
  expect(await readdir(directory)).toEqual([]);
  expect(
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mock.calls.map(([, args]) => args.artifactId)
  ).toEqual([filename.slice(0, -4), filename.slice(0, -4)]);
  expect(logger.info).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringMatching(
      /^Uploaded preview screenshot screenshot-2026-09-24T08-45-59-123Z\.png \(3 B\) in \d+ ms after 1 failed attempt\.$/
    )
  );
  expect(failedUploads.size).toBe(0);
  expect(Sentry.capture).not.toHaveBeenCalled();
});

it('uploads atomic captures immediately, including a capture arriving during another upload', async () => {
  jest.useFakeTimers();
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  let releaseFirstUpload!: () => void;
  const firstUploadGate = new Promise<void>(resolve => {
    releaseFirstUpload = resolve;
  });
  let signalFirstUpload!: () => void;
  const firstUploadStarted = new Promise<void>(resolve => {
    signalFirstUpload = resolve;
  });
  let signalSecondUpload!: () => void;
  const secondUploadStarted = new Promise<void>(resolve => {
    signalSecondUpload = resolve;
  });
  const uploadNormally = jest.mocked(uploadDeviceRunSessionArtifactAsync).getMockImplementation();
  if (!uploadNormally) {
    throw new Error('Expected the default upload implementation.');
  }
  jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mockImplementationOnce(async (...args) => {
      signalFirstUpload();
      await firstUploadGate;
      await uploadNormally(...args);
    })
    .mockImplementationOnce(async (...args) => {
      signalSecondUpload();
      await uploadNormally(...args);
    });
  const firstFile = path.join(
    collector.directory,
    'screenshot-2026-09-24T08-45-59-123Z-aaaaaaaaaaaa.png'
  );
  const secondFile = path.join(
    collector.directory,
    'screenshot-2026-09-24T08-45-59-124Z-bbbbbbbbbbbb.png'
  );
  try {
    await writeFile(`${firstFile}.tmp`, 'first-capture');
    await rename(`${firstFile}.tmp`, firstFile);
    await firstUploadStarted;
    await writeFile(`${secondFile}.tmp`, 'second-capture');
    await rename(`${secondFile}.tmp`, secondFile);
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
    releaseFirstUpload();
    await secondUploadStarted;
    await collector.finishAsync(true);
    expect(uploaded).toEqual([Buffer.from('first-capture'), Buffer.from('second-capture')]);
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(2);
  } finally {
    releaseFirstUpload();
    jest.useRealTimers();
    await collector.finishAsync(true);
    await rm(collector.directory, { recursive: true, force: true });
  }
});

it('uses periodic scans when watching is unavailable and does not overlap uploads', async () => {
  jest.useFakeTimers();
  const watchSpy = jest.spyOn(fs, 'watch').mockImplementation(() => {
    throw new Error('Watching unavailable');
  });
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>(resolve => {
    releaseUpload = resolve;
  });
  let signalUploadStarted!: () => void;
  const uploadStarted = new Promise<void>(resolve => {
    signalUploadStarted = resolve;
  });
  try {
    await writeFile(
      path.join(collector.directory, 'screenshot-2026-09-24T08-45-59-123Z-aaaaaaaaaaaa.png'),
      'live-capture'
    );
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementationOnce(async () => {
      signalUploadStarted();
      await uploadGate;
    });
    jest.advanceTimersByTime(30_000);
    await uploadStarted;
    jest.advanceTimersByTime(60_000);
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
    releaseUpload();
    await collector.finishAsync(true);
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
  } finally {
    releaseUpload();
    watchSpy.mockRestore();
    jest.useRealTimers();
    await collector.finishAsync(true);
    await rm(collector.directory, { recursive: true, force: true });
  }
});

it('warns for the first three attempts and every tenth after, without reporting to Sentry', async () => {
  const filename = `screenshot-2026-09-24T08-45-59-123Z-${randomBytes(6).toString('hex')}.png`;
  await writeFile(path.join(directory, filename), 'png');
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValue(new Error('offline'));
  for (let i = 0; i < 12; i++) {
    await flush();
  }
  expect(jest.mocked(logger.warn).mock.calls.map(([fields]) => fields.attempt)).toEqual([
    1, 2, 3, 10,
  ]);
  expect(logger.warn).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ file: path.join(directory, filename), attempt: 1, size: 3 }),
    'Could not upload preview screenshot (attempt 1). Keeping it for retry.'
  );
  expect(logger.warn).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ attempt: 2 }),
    'Could not upload preview screenshot (attempt 2). Keeping it for retry.'
  );
  expect(failedUploads.get(filename)).toEqual({
    attempts: 12,
    lastError: expect.objectContaining({ message: 'offline' }),
  });
  expect(Sentry.capture).not.toHaveBeenCalled();
});

it('removes an empty directory on finish and returns the same task when finish repeats', async () => {
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  const finish = collector.finishAsync(true);
  expect(collector.finishAsync(true)).toBe(finish);
  await finish;
  await expect(readdir(collector.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(logger.info).toHaveBeenCalledWith('Uploaded 0 preview screenshots during the session.');
  expect(Sentry.capture).not.toHaveBeenCalled();
});

it('keeps the directory and warns when the session host is still running', async () => {
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  try {
    await collector.finishAsync(false);
    expect(await readdir(collector.directory)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      { directory: collector.directory },
      'The session host is still running, so preview screenshots it saves from now on are not uploaded.'
    );
    expect(Sentry.capture).not.toHaveBeenCalled();
  } finally {
    await rm(collector.directory, { recursive: true, force: true });
  }
});

it('warns with the files not uploaded and their last error, and reports them to Sentry once', async () => {
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  const filename = 'screenshot-2026-09-24T08-45-59-123Z-aaaaaaaaaaaa.png';
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValue(new Error('offline'));
  try {
    await writeFile(path.join(collector.directory, filename), 'png');
    await collector.finishAsync(true);
    const notUploaded = [{ name: filename, attempts: expect.any(Number), lastError: 'offline' }];
    expect(logger.warn).toHaveBeenCalledWith(
      { directory: collector.directory, files: notUploaded },
      '1 preview screenshot was not uploaded.'
    );
    expect(Sentry.capture).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Preview screenshots were not uploaded',
      expect.objectContaining({
        message: '1 preview screenshot was not uploaded.',
      }),
      { extras: { files: notUploaded } }
    );
  } finally {
    await rm(collector.directory, { recursive: true, force: true });
  }
});

it('reports a screenshot as not uploaded when the shutdown deadline cuts off its upload', async () => {
  jest.useFakeTimers();
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  const filename = 'screenshot-2026-09-24T08-45-59-123Z-aaaaaaaaaaaa.png';
  const file = path.join(collector.directory, filename);
  let signalUploadStarted!: () => void;
  const uploadStarted = new Promise<void>(resolve => {
    signalUploadStarted = resolve;
  });
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async (_ctx, { signal }) => {
    signalUploadStarted();
    await new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    });
  });
  try {
    await writeFile(file, 'png');
    const finish = collector.finishAsync(true);
    await uploadStarted;
    jest.advanceTimersByTime(30_000);
    await finish;
    expect(logger.warn).toHaveBeenCalledWith(
      { directory: collector.directory },
      'Preview screenshot flush timed out after 30 s.'
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { file, size: 3 },
      'Shutdown deadline reached before this preview screenshot uploaded. Keeping the file.'
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { directory: collector.directory, files: [{ name: filename }] },
      '1 preview screenshot was not uploaded.'
    );
    expect(logger.info).toHaveBeenCalledWith('Uploaded 0 preview screenshots during the session.');
    expect(Sentry.capture).toHaveBeenCalledTimes(1);
    expect(await readdir(collector.directory)).toEqual([filename]);
  } finally {
    jest.useRealTimers();
    await rm(collector.directory, { recursive: true, force: true });
  }
});

it('reports a failure record once and deletes it while uploading captures from the same scan', async () => {
  const png = 'screenshot-2026-09-24T08-45-59-123Z-aaaaaaaaaaaa.png';
  const failed = 'screenshot-2026-09-24T08-45-59-124Z-bbbbbbbbbbbb.png';
  const record = { file: failed, error: 'ENOSPC: no space left', at: '2026-09-24T08:45:59.124Z' };
  await writeFile(path.join(directory, png), 'png');
  await writeFile(
    path.join(directory, 'screenshot-2026-09-24T08-45-59-124Z-bbbbbbbbbbbb.failed.json'),
    JSON.stringify(record)
  );
  expect(await flush()).toEqual({ uploaded: 1, saveFailures: 1 });
  expect(await flush()).toEqual({ uploaded: 0, saveFailures: 0 });
  expect(uploaded).toEqual([Buffer.from('png')]);
  expect(await readdir(directory)).toEqual([]);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    record,
    'The session host could not save a preview screenshot.'
  );
  expect(Sentry.capture).toHaveBeenCalledTimes(1);
  expect(Sentry.capture).toHaveBeenCalledWith(
    'The session host could not save a preview screenshot',
    expect.objectContaining({ message: 'ENOSPC: no space left' }),
    { extras: { file: failed, at: record.at } }
  );
});

it('warns about a malformed failure record, deletes it, and does not report it to Sentry', async () => {
  const file = path.join(directory, 'screenshot-2026-09-24T08-45-59-124Z-bbbbbbbbbbbb.failed.json');
  await writeFile(file, JSON.stringify({ file: 'screenshot.png' }));
  await flush();
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.anything(), file },
    'Could not read a preview screenshot failure record.'
  );
  expect(await readdir(directory)).toEqual([]);
  expect(Sentry.capture).not.toHaveBeenCalled();
});

it('handles a failure record as soon as it appears and counts it on finish', async () => {
  jest.useFakeTimers();
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  let signalReported!: () => void;
  const reported = new Promise<void>(resolve => {
    signalReported = resolve;
  });
  jest.mocked(Sentry.capture).mockImplementationOnce(() => signalReported());
  const record = path.join(
    collector.directory,
    'screenshot-2026-09-24T08-45-59-124Z-bbbbbbbbbbbb.failed.json'
  );
  try {
    await writeFile(`${record}.tmp`, JSON.stringify({ file: 'x.png', error: 'EIO', at: 'now' }));
    await rename(`${record}.tmp`, record);
    await reported;
    await collector.finishAsync(true);
    expect(logger.info).toHaveBeenCalledWith(
      'Uploaded 0 preview screenshots during the session; the session host could not save 1.'
    );
  } finally {
    jest.useRealTimers();
    await collector.finishAsync(true);
    await rm(collector.directory, { recursive: true, force: true });
  }
});
