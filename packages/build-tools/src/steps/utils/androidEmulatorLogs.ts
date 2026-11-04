import { type bunyan } from '@expo/logger';
import { type BuildStepGlobalContext } from '@expo/steps';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  AndroidEmulatorLogCapture,
  MAX_ANDROID_LOG_BYTES_PER_SOURCE,
} from '../../utils/androidEmulatorLogCapture';
import { type AndroidEmulatorLogSource } from '../../utils/androidEmulatorLogSources';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const MAX_BYTES_PER_FILE = MAX_ANDROID_LOG_BYTES_PER_SOURCE;
const UPLOAD_TIMEOUT_MS = 30_000;

type Collection = {
  capture: AndroidEmulatorLogCapture;
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
): AndroidEmulatorLogCapture {
  let collection = collections.get(global);
  if (!collection) {
    collection = {
      directories: new Set(),
      uploaded: new Set(),
      capture: new AndroidEmulatorLogCapture(),
    };
    collections.set(global, collection);
  }
  collection.directories.add(directory);
  return collection.capture;
}

export async function collectAndroidEmulatorLogsAsync(
  ctx: CustomBuildContext,
  {
    global,
    deviceRunSessionId,
    logger,
    maxBytes = MAX_BYTES_PER_FILE,
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
  await collection.capture.finishAsync();
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
            bytesSeen: collection.capture.getBytesSeen(filePath),
            source,
            maxBytes,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
            logger,
          });
          if (uploaded) {
            collection.uploaded.add(filePath);
            logger.info(`Uploaded Android diagnostic log ${entry.name}.`);
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
    bytesSeen,
    source,
    maxBytes,
    signal,
    logger,
  }: {
    deviceRunSessionId: string;
    filePath: string;
    bytesSeen?: number;
    source: AndroidEmulatorLogSource;
    maxBytes: number;
    signal: AbortSignal;
    logger: bunyan;
  }
): Promise<boolean> {
  const file = await open(filePath, 'r');
  let snapshotDirectory: string | undefined;
  try {
    const { size: fileSizeBytes } = await file.stat();
    const originalSizeBytes = bytesSeen ?? fileSizeBytes;
    if (fileSizeBytes === 0) {
      return false;
    }
    snapshotDirectory = await mkdtemp(path.join(os.tmpdir(), 'eas-android-log-snapshot-'));
    const filename = path.basename(filePath);
    const snapshotPath = path.join(snapshotDirectory, filename);
    const end = Math.min(fileSizeBytes, maxBytes) - 1;
    // The emulator may still append. Fix both the range and upload contents now,
    // so Content-Length and every retry describe the same snapshot.
    await pipeline(
      createReadStream(filePath, {
        fd: file,
        autoClose: false,
        start: 0,
        end,
      }),
      createWriteStream(snapshotPath),
      { signal }
    );
    const { size } = await stat(snapshotPath);
    if (size === 0) {
      return false;
    }
    const readController = new AbortController();
    const retainedSize =
      size >= 1024 * 1024 ? `${Number((size / (1024 * 1024)).toFixed(2))} MiB` : `${size} bytes`;
    const truncationNote = size < originalSizeBytes ? `; truncated, ${retainedSize} retained` : '';
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: filename,
      name: `${source === 'emulator-output' ? 'Emulator output' : 'Android device logcat'} (${filename.replace(/-(emulator|logcat)\.log$/, '')}${truncationNote})`,
      filename,
      kind: 'simulator-log',
      metadata: {
        __eas_type: 'simulator-log',
        platform: 'android',
        source,
        scope: source === 'emulator-output' ? 'emulator-process' : 'device',
        originalSizeBytes,
        omittedBytes: originalSizeBytes - size,
        truncated: size < originalSizeBytes,
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
