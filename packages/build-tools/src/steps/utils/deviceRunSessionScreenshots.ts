import type { bunyan } from '@expo/logger';
import { type FSWatcher, createReadStream, watch } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
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
    failedUploads: Map<string, { attempts: number; lastError: Error }>;
    session?: Promise<ScreenshotSession | null>;
  }
): Promise<{ uploaded: number; saveFailures: number }> {
  let uploadedCount = 0;
  let saveFailures = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (signal.aborted) {
      break;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (SCREENSHOT_FAILURE_RECORD_PATTERN.test(entry.name)) {
      await reportScreenshotFailureRecordAsync(path.join(directory, entry.name), logger);
      saveFailures++;
      continue;
    }
    const filenameMatch = SCREENSHOT_FILENAME_PATTERN.exec(entry.name);
    const timestamp = filenameMatch?.groups?.timestamp;
    if (!timestamp) {
      continue;
    }
    const file = path.join(directory, entry.name);
    let size: number | undefined;
    try {
      size = (await stat(file)).size;
      const artifactDetails = screenshotArtifactDetails(timestamp, await session);
      const startedAt = Date.now();
      await uploadDeviceRunSessionArtifactAsync(ctx, {
        deviceRunSessionId,
        artifactId: entry.name.slice(0, -4),
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
      uploadedCount++;
      const previousFailures = failedUploads.get(entry.name)?.attempts ?? 0;
      failedUploads.delete(entry.name);
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
    } catch (err) {
      if (size === undefined && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      if (signal.aborted) {
        logger.warn(
          { file, size },
          'Shutdown deadline reached before this preview screenshot uploaded. Keeping the file.'
        );
        break;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      const attempt = (failedUploads.get(entry.name)?.attempts ?? 0) + 1;
      failedUploads.set(entry.name, { attempts: attempt, lastError: error });
      // A sustained outage would otherwise warn for every retained file on each 30 s scan.
      if (attempt <= 3 || attempt % 10 === 0) {
        logger.warn(
          { err: error, file, attempt, size },
          `Could not upload preview screenshot (attempt ${attempt}). Keeping it for retry.`
        );
      }
    }
  }
  return { uploaded: uploadedCount, saveFailures };
}

export async function startDeviceRunSessionScreenshotsAsync(
  ctx: CustomBuildContext,
  options: { deviceRunSessionId: string; logger: bunyan }
): Promise<{ directory: string; finishAsync: () => Promise<void> }> {
  const session = loadScreenshotSessionAsync(ctx, options.deviceRunSessionId, options.logger);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'device-session-screenshots-'));
  const failedUploads = new Map<string, { attempts: number; lastError: Error }>();
  let uploadedCount = 0;
  let saveFailureCount = 0;
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
        uploadedCount += uploaded;
        saveFailureCount += saveFailures;
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

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (
        filename === null ||
        SCREENSHOT_FILENAME_PATTERN.test(filename) ||
        SCREENSHOT_FAILURE_RECORD_PATTERN.test(filename)
      ) {
        void flush();
      }
    });
    watcher.on('error', err => {
      options.logger.warn({ err, directory }, 'Screenshot watcher failed; using periodic scans.');
      watcher?.close();
    });
  } catch (err) {
    options.logger.warn({ err, directory }, 'Could not watch screenshots; using periodic scans.');
  }

  const timer = setInterval(() => {
    void flush();
  }, 30_000);
  timer.unref();
  let finishTask: Promise<void> | null = null;
  return {
    directory,
    finishAsync() {
      if (finishTask) {
        return finishTask;
      }

      finishTask = (async () => {
        watcher?.close();
        clearInterval(timer);
        // This shutdown budget wins over the uploader's own 90 s stall deadline, so a slow upload
        // at shutdown is retained rather than delaying teardown.
        const deadline = setTimeout(() => controller.abort(), 30_000);
        try {
          await pending;
          await flush();
          if (controller.signal.aborted) {
            options.logger.warn({ directory }, 'Preview screenshot flush timed out after 30 s.');
          }
          const saveFailureNote =
            saveFailureCount > 0 ? `; the session host could not save ${saveFailureCount}` : '';
          options.logger.info(
            `Uploaded ${uploadedCount} preview screenshots during the session${saveFailureNote}.`
          );
          const files = await readdir(directory);
          if (files.length === 0) {
            await rm(directory, { recursive: true });
          } else {
            const retained = files.map(name => {
              const failure = failedUploads.get(name);
              return failure
                ? { name, attempts: failure.attempts, lastError: failure.lastError.message }
                : { name };
            });
            const message = `Retained ${files.length} preview screenshots that were not uploaded.`;
            options.logger.warn({ directory, files: retained }, message);
            Sentry.capture('Preview screenshots were not uploaded', new Error(message), {
              extras: { files: retained },
            });
          }
        } catch (err) {
          options.logger.warn({ err, directory }, 'Could not finish preview screenshot uploads.');
        } finally {
          clearTimeout(deadline);
        }
      })();

      return finishTask;
    },
  };
}
