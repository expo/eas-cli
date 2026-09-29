import type { bunyan } from '@expo/logger';
import { type FSWatcher, createReadStream, watch } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, rmdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import type { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { formatBytes } from '../../utils/artifacts';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';
import {
  type ScreenshotSession,
  loadScreenshotSessionAsync,
  screenshotArtifactDetails,
} from './deviceRunSessionScreenshotNames';

// The device-hub repository writes these files from
// packages/serve-sim/packages/serve-sim/src/screenshot-artifacts.ts and
// packages/serve-emu/packages/serve-emu/src/screenshot-artifacts.ts.
// When a capture cannot be saved, the same files write a failure record in its place.
// These patterns, the record schema and the producer code must change together.
const SCREENSHOT_FILENAME_PATTERN =
  /^screenshot-(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-f0-9]{12}\.png$/;
const SCREENSHOT_FAILURE_RECORD_PATTERN =
  /^screenshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{12}\.failed\.json$/;
const ScreenshotFailureRecordSchema = z.object({
  file: z.string(),
  error: z.string(),
  at: z.string(),
});

async function reportScreenshotFailureRecordAsync(file: string, logger: bunyan): Promise<void> {
  try {
    const record = ScreenshotFailureRecordSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    logger.warn(
      { file: record.file, error: record.error, at: record.at },
      'The session host could not save a preview screenshot.'
    );
    Sentry.capture(
      'The session host could not save a preview screenshot',
      new Error(record.error),
      {
        extras: { file: record.file, at: record.at },
      }
    );
  } catch (err) {
    logger.warn({ err, file }, 'Could not read a preview screenshot failure record.');
  }
  await rm(file, { force: true });
}

type FailedUploads = Map<string, { attempts: number; lastError: Error }>;

type ScreenshotEntry = { kind: 'failureRecord' } | { kind: 'screenshot'; timestamp: string };

function classifyScreenshotEntry(name: string): ScreenshotEntry | null {
  if (SCREENSHOT_FAILURE_RECORD_PATTERN.test(name)) {
    return { kind: 'failureRecord' };
  }
  const timestamp = SCREENSHOT_FILENAME_PATTERN.exec(name)?.groups?.timestamp;
  return timestamp ? { kind: 'screenshot', timestamp } : null;
}

async function uploadScreenshotAsync(
  ctx: CustomBuildContext,
  {
    file,
    name,
    timestamp,
    size,
    deviceRunSessionId,
    session,
    signal,
    failedUploads,
    logger,
  }: {
    file: string;
    name: string;
    timestamp: string;
    size: number;
    deviceRunSessionId: string;
    session: Promise<ScreenshotSession | null>;
    signal: AbortSignal;
    failedUploads: FailedUploads;
    logger: bunyan;
  }
): Promise<void> {
  const artifactDetails = screenshotArtifactDetails(timestamp, await session);
  const startedAt = Date.now();
  await uploadDeviceRunSessionArtifactAsync(ctx, {
    deviceRunSessionId,
    artifactId: name.slice(0, -4),
    name: artifactDetails.name,
    filename: artifactDetails.filename,
    metadata: artifactDetails.metadata,
    kind: 'screenshot',
    size,
    stream: createReadStream(file),
    reopenStream: () => createReadStream(file),
    signal,
  });
  await rm(file);
  const previousFailures = failedUploads.get(name)?.attempts ?? 0;
  failedUploads.delete(name);
  // Each earlier failed attempt may have left an artifact row without a file on the server.
  // The API deletes such rows when the job run finishes (expo/universe#31539).
  const retryNote =
    previousFailures > 0
      ? ` after ${previousFailures} failed attempt${previousFailures === 1 ? '' : 's'}`
      : '';
  logger.info(
    { file },
    `Uploaded preview screenshot ${artifactDetails.filename} (${formatBytes(size)}) in ${Date.now() - startedAt} ms${retryNote}.`
  );
}

function recordUploadFailure(
  err: unknown,
  {
    file,
    name,
    size,
    signal,
    failedUploads,
    logger,
  }: {
    file: string;
    name: string;
    size: number | undefined;
    signal: AbortSignal;
    failedUploads: FailedUploads;
    logger: bunyan;
  }
): 'aborted' | 'recorded' {
  if (signal.aborted) {
    logger.warn(
      { file, size },
      'Shutdown deadline reached before this preview screenshot uploaded. Keeping the file.'
    );
    return 'aborted';
  }
  const error = err instanceof Error ? err : new Error(String(err));
  const attempt = (failedUploads.get(name)?.attempts ?? 0) + 1;
  failedUploads.set(name, { attempts: attempt, lastError: error });
  // A sustained outage would otherwise warn for every retained file on each 30 s scan.
  if (attempt <= 3 || attempt % 10 === 0) {
    logger.warn(
      { err: error, file, attempt, size },
      `Could not upload preview screenshot (attempt ${attempt}). Keeping it for retry.`
    );
  }
  return 'recorded';
}

/**
 * Only atomically completed PNGs are eligible; failed uploads stay on disk for retry.
 * Failure records are reported once and deleted.
 */
export async function uploadDeviceRunSessionScreenshotsAsync(
  ctx: CustomBuildContext,
  {
    directory,
    deviceRunSessionId,
    logger,
    signal,
    failedUploads,
    session = Promise.resolve(null),
  }: {
    directory: string;
    deviceRunSessionId: string;
    logger: bunyan;
    signal: AbortSignal;
    failedUploads: FailedUploads;
    session?: Promise<ScreenshotSession | null>;
  }
): Promise<{ uploaded: number; saveFailures: number }> {
  let uploadedCount = 0;
  let saveFailures = 0;
  // Names start with the capture time. Captures that never failed go first, oldest first, so a
  // capture that keeps stalling cannot hold back newer ones or use up the shutdown budget.
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) =>
      Number(failedUploads.has(a.name)) - Number(failedUploads.has(b.name)) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
  for (const entry of entries) {
    if (signal.aborted) {
      break;
    }
    const classified = entry.isFile() ? classifyScreenshotEntry(entry.name) : null;
    if (!classified) {
      continue;
    }
    const file = path.join(directory, entry.name);
    if (classified.kind === 'failureRecord') {
      await reportScreenshotFailureRecordAsync(file, logger);
      saveFailures++;
      continue;
    }
    let size: number | undefined;
    try {
      size = (await stat(file)).size;
      await uploadScreenshotAsync(ctx, {
        file,
        name: entry.name,
        timestamp: classified.timestamp,
        size,
        deviceRunSessionId,
        session,
        signal,
        failedUploads,
        logger,
      });
      uploadedCount++;
    } catch (err) {
      if (size === undefined && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      const outcome = recordUploadFailure(err, {
        file,
        name: entry.name,
        size,
        signal,
        failedUploads,
        logger,
      });
      if (outcome === 'aborted') {
        break;
      }
    }
  }
  return { uploaded: uploadedCount, saveFailures };
}

function watchScreenshotDirectory(
  directory: string,
  onChange: () => void,
  logger: bunyan
): () => void {
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (
        filename === null ||
        SCREENSHOT_FILENAME_PATTERN.test(filename) ||
        SCREENSHOT_FAILURE_RECORD_PATTERN.test(filename)
      ) {
        onChange();
      }
    });
    watcher.on('error', err => {
      logger.warn({ err, directory }, 'Screenshot watcher failed; using periodic scans.');
      watcher?.close();
    });
  } catch (err) {
    logger.warn({ err, directory }, 'Could not watch screenshots; using periodic scans.');
  }
  return () => watcher?.close();
}

// A capture can land after the final scan. rmdir refuses a non-empty directory, so that capture is
// reported as retained instead of being deleted with the directory.
async function removeEmptyDirectoryAsync(directory: string): Promise<boolean> {
  try {
    await rmdir(directory);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
      return false;
    }
    throw err;
  }
}

async function reportRetainedScreenshotsAsync({
  directory,
  hostStopped,
  failedUploads,
  logger,
}: {
  directory: string;
  hostStopped: boolean;
  failedUploads: FailedUploads;
  logger: bunyan;
}): Promise<void> {
  if (hostStopped && (await removeEmptyDirectoryAsync(directory))) {
    return;
  }
  const files = await readdir(directory);
  if (files.length === 0) {
    return;
  }
  const retained = files.map(name => {
    const failure = failedUploads.get(name);
    return failure
      ? { name, attempts: failure.attempts, lastError: failure.lastError.message }
      : { name };
  });
  const message = `Retained ${files.length} preview screenshots that were not uploaded.`;
  logger.warn({ directory, files: retained }, message);
  Sentry.capture('Preview screenshots were not uploaded', new Error(message), {
    extras: { files: retained },
  });
}

async function finishCollectionAsync({
  directory,
  hostStopped,
  logger,
  stopWatching,
  timer,
  controller,
  drainAsync,
  totals,
  failedUploads,
}: {
  directory: string;
  hostStopped: boolean;
  logger: bunyan;
  stopWatching: () => void;
  timer: NodeJS.Timeout;
  controller: AbortController;
  drainAsync: () => Promise<void>;
  totals: { uploaded: number; saveFailures: number };
  failedUploads: FailedUploads;
}): Promise<void> {
  stopWatching();
  clearInterval(timer);
  // This shutdown budget wins over the uploader's own 90 s stall deadline, so a slow upload
  // at shutdown is retained rather than delaying teardown.
  const deadline = setTimeout(() => controller.abort(), 30_000);
  try {
    await drainAsync();
    if (controller.signal.aborted) {
      logger.warn({ directory }, 'Preview screenshot flush timed out after 30 s.');
    }
    const saveFailureNote =
      totals.saveFailures > 0 ? `; the session host could not save ${totals.saveFailures}` : '';
    logger.info(
      `Uploaded ${totals.uploaded} preview screenshots during the session${saveFailureNote}.`
    );
    if (!hostStopped) {
      logger.warn(
        { directory },
        'The session host is still running, so preview screenshots it saves from now on are not uploaded.'
      );
    }
    await reportRetainedScreenshotsAsync({ directory, hostStopped, failedUploads, logger });
  } catch (err) {
    logger.warn({ err, directory }, 'Could not finish preview screenshot uploads.');
  } finally {
    clearTimeout(deadline);
  }
}

export async function startDeviceRunSessionScreenshotsAsync(
  ctx: CustomBuildContext,
  options: { deviceRunSessionId: string; logger: bunyan }
): Promise<{ directory: string; finishAsync: (hostStopped: boolean) => Promise<void> }> {
  const session = loadScreenshotSessionAsync(ctx, options.deviceRunSessionId, options.logger);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'device-session-screenshots-'));
  const failedUploads: FailedUploads = new Map();
  const totals = { uploaded: 0, saveFailures: 0 };
  const controller = new AbortController();
  let pending: Promise<void> | null = null;
  let scanRequested = false;

  const collectRequestedScreenshotsAsync = async (): Promise<void> => {
    while (scanRequested && !controller.signal.aborted) {
      scanRequested = false;
      try {
        const { uploaded, saveFailures } = await uploadDeviceRunSessionScreenshotsAsync(ctx, {
          ...options,
          session,
          directory,
          failedUploads,
          signal: controller.signal,
        });
        totals.uploaded += uploaded;
        totals.saveFailures += saveFailures;
      } catch (err) {
        options.logger.warn({ err, directory }, 'Could not collect preview screenshots.');
      }
    }
  };

  const flush = (): Promise<void> => {
    scanRequested = true;
    if (pending) {
      return pending;
    }

    pending = collectRequestedScreenshotsAsync().finally(() => {
      pending = null;
    });
    return pending;
  };

  const stopWatching = watchScreenshotDirectory(directory, () => void flush(), options.logger);
  const timer = setInterval(() => {
    void flush();
  }, 30_000);
  timer.unref();
  let finishTask: Promise<void> | null = null;
  return {
    directory,
    finishAsync(hostStopped) {
      finishTask ??= finishCollectionAsync({
        directory,
        hostStopped,
        logger: options.logger,
        stopWatching,
        timer,
        controller,
        drainAsync: async () => {
          await pending;
          await flush();
        },
        totals,
        failedUploads,
      });
      return finishTask;
    },
  };
}
