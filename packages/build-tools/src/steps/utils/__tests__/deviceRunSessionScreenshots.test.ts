import type { bunyan } from '@expo/logger';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
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
let failedAttempts: Map<string, number>;

beforeEach(async () => {
  jest.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), 'screenshots-test-'));
  uploaded = [];
  failedAttempts = new Map();
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
    failedAttempts,
    signal: new AbortController().signal,
  });

it('uploads completed captures with their bytes and stable IDs, ignoring partial files and symlinks', async () => {
  const filename = `screenshot-2026-09-24T08-45-59-123Z-${randomBytes(6).toString('hex')}.png`;
  await writeFile(path.join(directory, filename), 'png-content');
  await writeFile(path.join(directory, `${filename}.tmp`), 'partial');
  await symlink(
    path.join(directory, filename),
    path.join(
      directory,
      `screenshot-2026-09-24T08-45-59-123Z-${randomBytes(6).toString('hex')}.png`
    )
  );
  await flush();
  await flush();
  expect(uploaded).toEqual([Buffer.from('png-content')]);
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      deviceRunSessionId: 'session-id',
      artifactId: filename.slice(0, -4),
      filename: 'screenshot-2026-09-24T08-45-59-123Z.png',
      kind: 'screenshot',
      size: 11,
    })
  );
  expect(await readdir(directory)).not.toContain(filename);
});

it('retains failed uploads and retries the same artifact ID', async () => {
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
});

it('flushes a capture made just before shutdown exactly once and removes the drained directory', async () => {
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  await writeFile(
    path.join(
      collector.directory,
      `screenshot-2026-09-24T08-45-59-123Z-${randomBytes(6).toString('hex')}.png`
    ),
    'last-capture'
  );
  const finish = collector.finishAsync();
  expect(collector.finishAsync()).toBe(finish);
  await finish;
  expect(uploaded).toEqual([Buffer.from('last-capture')]);
  await expect(readdir(collector.directory)).rejects.toMatchObject({ code: 'ENOENT' });
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
    await collector.finishAsync();
    expect(uploaded).toEqual([Buffer.from('first-capture'), Buffer.from('second-capture')]);
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(2);
  } finally {
    releaseFirstUpload();
    jest.useRealTimers();
    await collector.finishAsync();
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
    await collector.finishAsync();
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
  } finally {
    releaseUpload();
    watchSpy.mockRestore();
    jest.useRealTimers();
    await collector.finishAsync();
    await rm(collector.directory, { recursive: true, force: true });
  }
});

it('warns with the attempt count and reports each file to Sentry only once', async () => {
  const filename = `screenshot-2026-09-24T08-45-59-123Z-${randomBytes(6).toString('hex')}.png`;
  await writeFile(path.join(directory, filename), 'png');
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValue(new Error('offline'));
  await flush();
  await flush();
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
  expect(Sentry.capture).toHaveBeenCalledTimes(1);
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not upload preview screenshot',
    expect.objectContaining({ message: 'offline' })
  );
});

it('logs the failed attempt count when an upload succeeds on retry', async () => {
  const filename = `screenshot-2026-09-24T08-45-59-123Z-${randomBytes(6).toString('hex')}.png`;
  await writeFile(path.join(directory, filename), 'png');
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValueOnce(new Error('offline'));
  await flush();
  await flush();
  expect(logger.info).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringMatching(
      /^Uploaded preview screenshot screenshot-2026-09-24T08-45-59-123Z\.png \(3 B\) in \d+ ms after 1 failed attempt\.$/
    )
  );
  expect(failedAttempts.size).toBe(0);
});

it('removes an empty directory on finish even when the host may still be running', async () => {
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  await collector.finishAsync();
  await expect(readdir(collector.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(logger.info).toHaveBeenCalledWith('Uploaded 0 preview screenshots during the session.');
});

it('warns with the retained files when a screenshot is left on finish', async () => {
  const collector = await startDeviceRunSessionScreenshotsAsync(ctx, options);
  const filename = 'screenshot-2026-09-24T08-45-59-123Z-aaaaaaaaaaaa.png';
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValue(new Error('offline'));
  try {
    await writeFile(path.join(collector.directory, filename), 'png');
    await collector.finishAsync();
    expect(logger.warn).toHaveBeenCalledWith(
      { directory: collector.directory, files: [filename] },
      'Retained 1 preview screenshots that were not uploaded.'
    );
  } finally {
    await rm(collector.directory, { recursive: true, force: true });
  }
});
