import type { bunyan } from '@expo/logger';
import { type FSWatcher, createReadStream, watch } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
// This pattern and the producer pattern must change together.
const SCREENSHOT_FILENAME_PATTERN =
  /^screenshot-(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-f0-9]{12}\.png$/;

/**
 * Only atomically completed PNGs are eligible; failed uploads stay on disk for retry.
 * Returns the number of uploaded screenshots.
 */
export async function uploadDeviceRunSessionScreenshotsAsync(
  ctx: CustomBuildContext,
  {
    directory,
    deviceRunSessionId,
    logger,
    signal,
    failedAttempts,
    session = Promise.resolve(null),
  }: {
    directory: string;
    deviceRunSessionId: string;
    logger: bunyan;
    signal: AbortSignal;
    failedAttempts: Map<string, number>;
    session?: Promise<ScreenshotSession | null>;
  }
): Promise<number> {
  let uploadedCount = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (signal.aborted) {
      break;
    }
    if (!entry.isFile()) {
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
        name: 'Screenshot',
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
      const previousFailures = failedAttempts.get(entry.name) ?? 0;
      failedAttempts.delete(entry.name);
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
      const error = err instanceof Error ? err : new Error(String(err));
      const attempt = (failedAttempts.get(entry.name) ?? 0) + 1;
      failedAttempts.set(entry.name, attempt);
      if (attempt === 1) {
        Sentry.capture('Could not upload preview screenshot', error);
      }
      logger.warn(
        { err: error, file, attempt, size },
        `Could not upload preview screenshot (attempt ${attempt}). Keeping it for retry.`
      );
    }
  }
  return uploadedCount;
}

export async function startDeviceRunSessionScreenshotsAsync(
  ctx: CustomBuildContext,
  options: { deviceRunSessionId: string; logger: bunyan }
): Promise<{ directory: string; finishAsync: () => Promise<void> }> {
  const session = loadScreenshotSessionAsync(ctx, options.deviceRunSessionId, options.logger);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'device-session-screenshots-'));
  const failedAttempts = new Map<string, number>();
  let uploadedCount = 0;
  const controller = new AbortController();
  let pending: Promise<void> | null = null;
  let scanRequested = false;

  const collectRequestedScreenshotsAsync = async (): Promise<void> => {
    while (scanRequested && !controller.signal.aborted) {
      scanRequested = false;
      try {
        uploadedCount += await uploadDeviceRunSessionScreenshotsAsync(ctx, {
          ...options,
          session,
          directory,
          failedAttempts,
          signal: controller.signal,
        });
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
      if (filename === null || SCREENSHOT_FILENAME_PATTERN.test(filename)) {
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
        const deadline = setTimeout(() => controller.abort(), 30_000);
        try {
          await pending;
          await flush();
          if (controller.signal.aborted) {
            options.logger.warn({ directory }, 'Preview screenshot flush timed out after 30 s.');
          }
          options.logger.info(`Uploaded ${uploadedCount} preview screenshots during the session.`);
          const files = await readdir(directory);
          if (files.length === 0) {
            await rm(directory, { recursive: true });
          } else {
            options.logger.warn(
              { directory, files },
              `Retained ${files.length} preview screenshots that were not uploaded.`
            );
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
