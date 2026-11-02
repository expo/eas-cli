import { type bunyan } from '@expo/logger';
import { type BuildStepGlobalContext } from '@expo/steps';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import { type CustomBuildContext } from '../../customBuildContext';
import { type AndroidEmulatorLogSource } from '../../utils/androidEmulatorLogSources';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const MAX_UNCOMPRESSED_BYTES_PER_FILE = 100 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 30_000;

type Collection = {
  directories: Set<string>;
  uploaded: Set<string>;
  collecting?: Promise<void>;
};

// A worker can execute more than one job in its lifetime. Only the workflow that
// created a directory may collect it; never discover logs by scanning /tmp.
const collections = new WeakMap<BuildStepGlobalContext, Collection>();

export function registerAndroidEmulatorLogDirectory(
  global: BuildStepGlobalContext,
  directory: string
): void {
  let collection = collections.get(global);
  if (!collection) {
    collection = { directories: new Set(), uploaded: new Set() };
    collections.set(global, collection);
  }
  collection.directories.add(directory);
}

export async function collectAndroidEmulatorLogsAsync(
  ctx: CustomBuildContext,
  {
    global,
    deviceRunSessionId,
    logger,
    maxBytes = MAX_UNCOMPRESSED_BYTES_PER_FILE,
    sources = ['emulator-output'],
  }: {
    global: BuildStepGlobalContext;
    deviceRunSessionId: string;
    logger: bunyan;
    maxBytes?: number;
    sources?: readonly AndroidEmulatorLogSource[];
  }
): Promise<void> {
  const collection = collections.get(global);
  if (!collection) {
    logger.info('No Android emulator log directories registered; skipping upload.');
    return;
  }
  while (collection.collecting) {
    await collection.collecting;
  }
  collection.collecting = uploadRegisteredLogsAsync(ctx, {
    collection,
    deviceRunSessionId,
    logger,
    maxBytes,
    sources,
  });
  try {
    await collection.collecting;
  } finally {
    collection.collecting = undefined;
  }
}

async function uploadRegisteredLogsAsync(
  ctx: CustomBuildContext,
  {
    collection,
    deviceRunSessionId,
    logger,
    maxBytes,
    sources,
  }: {
    collection: Collection;
    deviceRunSessionId: string;
    logger: bunyan;
    maxBytes: number;
    sources: readonly AndroidEmulatorLogSource[];
  }
): Promise<void> {
  for (const directory of collection.directories) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const match = /-(emulator|logcat)\.log$/.exec(entry.name);
        if (!entry.isFile() || !match) {
          continue;
        }
        const source = match[1] === 'emulator' ? 'emulator-output' : 'device-logcat';
        if (!sources.includes(source)) {
          continue;
        }
        const filePath = path.join(directory, entry.name);
        if (collection.uploaded.has(filePath)) {
          continue;
        }
        try {
          const uploaded = await uploadLogSnapshotAsync(ctx, {
            deviceRunSessionId,
            filePath,
            source,
            maxBytes,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
            logger,
          });
          if (uploaded) {
            collection.uploaded.add(filePath);
            logger.info(`Uploaded Android diagnostic log ${entry.name}.`);
            // The uploaded snapshot is final for this capture. Unlink the raw file
            // only after success; an open emulator writer releases its storage on close.
            await rm(filePath, { force: true }).catch(err => {
              logger.warn({ err }, `Could not remove uploaded Android log ${entry.name}.`);
            });
          }
        } catch (err) {
          logger.warn(
            { err },
            `Could not upload Android log ${entry.name}; other logs will continue.`
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, `Could not read Android emulator log directory ${directory}.`);
    }
  }
}

async function uploadLogSnapshotAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    filePath,
    source,
    maxBytes,
    signal,
    logger,
  }: {
    deviceRunSessionId: string;
    filePath: string;
    source: AndroidEmulatorLogSource;
    maxBytes: number;
    signal: AbortSignal;
    logger: bunyan;
  }
): Promise<boolean> {
  const file = await open(filePath, 'r');
  let snapshotDirectory: string | undefined;
  try {
    const { size: originalSizeBytes } = await file.stat();
    if (originalSizeBytes === 0) {
      return false;
    }
    snapshotDirectory = await mkdtemp(path.join(os.tmpdir(), 'eas-android-log-snapshot-'));
    const originalFilename = path.basename(filePath);
    const filename = `${originalFilename}.gz`;
    const snapshotPath = path.join(snapshotDirectory, filename);
    const start = Math.max(0, originalSizeBytes - maxBytes);
    // The emulator may still append. Fix both the range and upload contents now,
    // then gzip the retained raw bytes in full. Never truncate compressed output;
    // Content-Length and every retry must describe the same complete gzip file.
    const gzip = createGzip({ level: 6 });
    await pipeline(
      createReadStream(filePath, {
        fd: file,
        autoClose: false,
        start,
        end: originalSizeBytes - 1,
      }),
      gzip,
      createWriteStream(snapshotPath),
      { signal }
    );
    const { size } = await stat(snapshotPath);
    const retainedSizeBytes = gzip.bytesWritten;
    if (retainedSizeBytes === 0) {
      return false;
    }
    const readController = new AbortController();
    const retainedSize =
      retainedSizeBytes >= 1024 * 1024
        ? `${Number((retainedSizeBytes / (1024 * 1024)).toFixed(2))} MiB`
        : `${retainedSizeBytes} bytes`;
    const truncationNote =
      retainedSizeBytes < originalSizeBytes ? `; truncated, ${retainedSize} retained` : '';
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: filename,
      name: `${source === 'emulator-output' ? 'Emulator output' : 'Android device logcat'} (${originalFilename.replace(/-(emulator|logcat)\.log$/, '')}${truncationNote})`,
      filename,
      kind: 'simulator-log',
      metadata: {
        __eas_type: 'simulator-log',
        platform: 'android',
        source,
        scope: source === 'emulator-output' ? 'emulator-process' : 'device',
        originalSizeBytes,
        retainedSizeBytes,
        compressedSizeBytes: size,
        compression: 'gzip',
        omittedBytes: originalSizeBytes - retainedSizeBytes,
        truncated: retainedSizeBytes < originalSizeBytes,
      },
      size,
      openStream: () =>
        createReadStream(snapshotPath).on('error', err => {
          // The uploader aborts an unfinished body after an HTTP error. That
          // cancels one attempt, not the file's remaining upload attempts.
          if (err.name !== 'AbortError') {
            readController.abort(err);
          }
        }),
      signal: AbortSignal.any([signal, readController.signal]),
      attempts: 2,
    });
    return true;
  } finally {
    await file.close().catch(err => {
      logger.warn({ err }, `Could not close Android log ${filePath}.`);
    });
    if (snapshotDirectory) {
      await rm(snapshotDirectory, { recursive: true, force: true }).catch(err => {
        logger.warn({ err }, 'Could not remove the Android log upload snapshot.');
      });
    }
  }
}
