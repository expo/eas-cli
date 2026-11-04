import { type bunyan } from '@expo/logger';
import { type BuildStepGlobalContext } from '@expo/steps';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  AndroidEmulatorLogCapture,
  type FinalizedAndroidEmulatorLog,
} from '../../utils/androidEmulatorLogCapture';
import { type AndroidEmulatorLogSource } from '../../utils/androidEmulatorLogSources';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const UPLOAD_TIMEOUT_MS = 30_000;

type Collection = {
  capture: AndroidEmulatorLogCapture;
  uploaded: Set<string>;
  collecting?: Promise<void>;
};

// A worker can execute more than one job; each workflow owns its capture and uploads.
const collections = new WeakMap<BuildStepGlobalContext, Collection>();

export function getAndroidEmulatorLogCapture(
  global: BuildStepGlobalContext
): AndroidEmulatorLogCapture {
  let collection = collections.get(global);
  if (!collection) {
    collection = { capture: new AndroidEmulatorLogCapture(), uploaded: new Set() };
    collections.set(global, collection);
  }
  return collection.capture;
}

export async function collectAndroidEmulatorLogsAsync(
  ctx: CustomBuildContext,
  {
    global,
    deviceRunSessionId,
    logger,
    sources = ['emulator-output'],
  }: {
    global: BuildStepGlobalContext;
    deviceRunSessionId: string;
    logger: bunyan;
    sources?: readonly AndroidEmulatorLogSource[];
  }
): Promise<void> {
  const collection = collections.get(global);
  if (!collection) {
    logger.info('No Android emulator logs captured; skipping upload.');
    return;
  }
  while (collection.collecting) {
    await collection.collecting;
  }
  collection.collecting = uploadCapturedLogsAsync(ctx, {
    collection,
    deviceRunSessionId,
    logger,
    sources,
  });
  try {
    await collection.collecting;
  } finally {
    collection.collecting = undefined;
  }
}

async function uploadCapturedLogsAsync(
  ctx: CustomBuildContext,
  {
    collection,
    deviceRunSessionId,
    logger,
    sources,
  }: {
    collection: Collection;
    deviceRunSessionId: string;
    logger: bunyan;
    sources: readonly AndroidEmulatorLogSource[];
  }
): Promise<void> {
  const logs = await collection.capture.finishAsync();
  for (const log of logs) {
    if (!sources.includes(log.source) || collection.uploaded.has(log.filePath)) {
      continue;
    }
    const filename = path.basename(log.filePath);
    try {
      const uploaded = await uploadLogAsync(ctx, {
        deviceRunSessionId,
        log,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (uploaded) {
        collection.uploaded.add(log.filePath);
        logger.info(`Uploaded Android diagnostic log ${filename}.`);
      }
    } catch (err) {
      logger.warn({ err }, `Could not upload Android log ${filename}; other logs will continue.`);
    }
  }
}

async function uploadLogAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    log: { filePath, source, bytesSeen },
    signal,
  }: {
    deviceRunSessionId: string;
    log: FinalizedAndroidEmulatorLog;
    signal: AbortSignal;
  }
): Promise<boolean> {
  const { size } = await stat(filePath);
  if (size === 0) {
    return false;
  }
  const filename = path.basename(filePath);
  const readController = new AbortController();
  const retainedSize =
    size >= 1024 * 1024 ? `${Number((size / (1024 * 1024)).toFixed(2))} MiB` : `${size} bytes`;
  const truncationNote = size < bytesSeen ? `; truncated, ${retainedSize} retained` : '';
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
      originalSizeBytes: bytesSeen,
      omittedBytes: bytesSeen - size,
      truncated: size < bytesSeen,
    },
    size,
    openStream: () =>
      createReadStream(filePath).on('error', err => {
        // An HTTP error aborts one request body, not the remaining upload attempts.
        if (err.name !== 'AbortError') {
          readController.abort(err);
        }
      }),
    signal: AbortSignal.any([signal, readController.signal]),
    attempts: 2,
  });
  return true;
}
