import { type bunyan } from '@expo/logger';
import { type BuildStepGlobalContext } from '@expo/steps';
import path from 'node:path';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  type AndroidEmulatorLogCapture,
  AndroidEmulatorLogRing,
  type FinalizedAndroidEmulatorLog,
} from '../../utils/androidEmulatorLogCapture';
import { AndroidEmulatorLogFiles } from '../../utils/androidEmulatorLogFiles';
import { type AndroidEmulatorLogSource } from '../../utils/androidEmulatorLogSources';
import { uploadDeviceRunSessionFileAsync } from './uploadDeviceRunSessionFile';

const UPLOAD_TIMEOUT_MS = 30_000;
const LOG_SOURCE_DETAILS = {
  'emulator-output': { name: 'Emulator output', scope: 'emulator-process' },
  'device-logcat': { name: 'Android device logcat', scope: 'device' },
} satisfies Record<AndroidEmulatorLogSource, { name: string; scope: string }>;

type Collection = {
  capture: AndroidEmulatorLogCapture;
  upload?: Promise<void>;
};

// A worker can execute more than one job; each workflow owns its capture and uploads.
const collections = new WeakMap<BuildStepGlobalContext, Collection>();

/** The first launch of a workflow fixes its source selection; later calls reuse the capture. */
export function getAndroidEmulatorLogCapture(
  global: BuildStepGlobalContext,
  env: NodeJS.ProcessEnv,
  sources: readonly AndroidEmulatorLogSource[]
): AndroidEmulatorLogCapture {
  let collection = collections.get(global);
  if (!collection) {
    collection = {
      // Sessions upload a bounded ring per source; builds keep plain launch files.
      capture: env.DEVICE_RUN_SESSION_ID
        ? new AndroidEmulatorLogRing({ sources })
        : new AndroidEmulatorLogFiles({ sources }),
    };
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
  }: {
    global: BuildStepGlobalContext;
    deviceRunSessionId: string;
    logger: bunyan;
  }
): Promise<void> {
  const collection = collections.get(global);
  if (!collection) {
    logger.info('No Android emulator logs captured; skipping upload.');
    return;
  }
  // Generated session workflows collect once. Repeated calls share that finalization/upload.
  collection.upload ??= uploadCapturedLogsAsync(ctx, {
    collection,
    deviceRunSessionId,
    logger,
  });
  await collection.upload;
}

async function uploadCapturedLogsAsync(
  ctx: CustomBuildContext,
  {
    collection,
    deviceRunSessionId,
    logger,
  }: {
    collection: Collection;
    deviceRunSessionId: string;
    logger: bunyan;
  }
): Promise<void> {
  const logs = await collection.capture.finishAsync();
  for (const log of logs) {
    const filename = path.basename(log.filePath);
    try {
      const uploaded = await uploadLogAsync(ctx, {
        deviceRunSessionId,
        log,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (uploaded) {
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
  const filename = path.basename(filePath);
  return await uploadDeviceRunSessionFileAsync(ctx, {
    filePath,
    describe: size => {
      const retainedSize =
        size >= 1024 * 1024 ? `${Number((size / (1024 * 1024)).toFixed(2))} MiB` : `${size} bytes`;
      const truncationNote = size < bytesSeen ? `; truncated, last ${retainedSize} retained` : '';
      return {
        deviceRunSessionId,
        artifactId: filename,
        name: `${LOG_SOURCE_DETAILS[source].name} (${filename}${truncationNote})`,
        filename,
        kind: 'simulator-log',
        metadata: {
          __eas_type: 'simulator-log',
          platform: 'android',
          source,
          scope: LOG_SOURCE_DETAILS[source].scope,
          originalSizeBytes: bytesSeen,
          // The capture keeps the newest bytes, so the omitted bytes are the head.
          omittedBytes: bytesSeen - size,
          truncated: size < bytesSeen,
        },
      };
    },
    signal,
    attempts: 2,
  });
}
