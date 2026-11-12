import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CustomBuildContext } from '../../customBuildContext';
import {
  type ArtifactMetadata,
  uploadDeviceRunSessionArtifactAsync,
} from './deviceRunSessionArtifacts';
import { ensureMacosPreviewEncoderInstalledAsync } from './deviceRunSessionPreview';
import {
  type ScreenshotMetadata,
  createScreenshotMetadataAsync,
} from './deviceRunSessionScreenshotMetadata';

export const SCREENSHOT_THUMBNAIL_KIND = 'screenshot-thumbnail';
const THUMBNAIL_MAX_WIDTH = 480;
const THUMBNAIL_QUALITY = 70;
const THUMBNAIL_ENCODE_TIMEOUT_MS = 10_000;
// A copy is optional, so it gets one attempt with this deadline for its encode and upload.
const THUMBNAIL_DEADLINE_MS = 30_000;
// At shutdown, the queue gets this long to finish. Then it cancels the copies that remain.
const THUMBNAIL_CLOSE_TIMEOUT_MS = 10_000;
// Each queued copy keeps a copy of its screenshot on disk until it is processed.
const MAX_QUEUED_THUMBNAILS = 50;

/** The runtime that encodes thumbnails: `cwebp` on macOS, FFmpeg with libwebp on Linux. */
export type ScreenshotThumbnailEncoder = {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
};

type ThumbnailArtifact = Omit<ArtifactMetadata, 'metadata'>;

type ThumbnailJob = {
  source: string;
  thumbnailKey: string;
  artifact: ThumbnailArtifact;
  metadata: ScreenshotMetadata;
};

/**
 * A queue that makes the small WebP copies of the screenshots of one session. It runs separately
 * from the screenshot uploads, so a slow copy never delays a screenshot. It makes one copy at a
 * time. A copy that cannot be made is skipped, and the website then shows the full screenshot.
 */
export type ScreenshotThumbnails = {
  /** Copies the screenshot file into the queue and returns. The file can be removed after this. */
  addAsync(job: {
    file: string;
    thumbnailKey: string;
    artifact: ThumbnailArtifact;
    metadata: ScreenshotMetadata;
  }): Promise<void>;
  /** Waits up to `timeoutMs` for the queue, then cancels the copies that remain. Never rejects. */
  closeAsync(timeoutMs?: number): Promise<void>;
};

export function createScreenshotThumbnails(
  ctx: CustomBuildContext,
  { runtimePlatform, env, logger }: ScreenshotThumbnailEncoder & { logger: bunyan }
): ScreenshotThumbnails {
  const controller = new AbortController();
  const queue: ThumbnailJob[] = [];
  let directory: Promise<string> | undefined;
  let encoderReady: Promise<void> | undefined;
  let running: Promise<void> | undefined;
  let accepting = true;
  let disabled = false;
  let skippedAsFull = 0;
  let closeTask: Promise<void> | undefined;

  const removeQueuedFilesAsync = async (): Promise<void> => {
    await Promise.all(queue.splice(0).map(job => rm(job.source, { force: true })));
  };

  const disableAsync = async (err: unknown, message: string): Promise<void> => {
    if (!disabled) {
      disabled = true;
      logger.warn({ err }, message);
    }
    await removeQueuedFilesAsync();
  };

  const processAsync = async (job: ThumbnailJob): Promise<void> => {
    const thumbnail = path.join(path.dirname(job.source), `${job.thumbnailKey}.webp`);
    try {
      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        // Homebrew's FFmpeg has no libwebp, so macOS uses cwebp. The session preview shares this
        // install, but the copies do not depend on the preview.
        encoderReady ??= ensureMacosPreviewEncoderInstalledAsync({
          env,
          logger,
          signal: controller.signal,
        });
        try {
          await encoderReady;
        } catch (err) {
          if (!controller.signal.aborted) {
            await disableAsync(
              err,
              'Could not install cwebp. The website shows full screenshots for this session.'
            );
          }
          return;
        }
      }
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(THUMBNAIL_DEADLINE_MS),
      ]);
      await encodeThumbnailAsync(job.source, thumbnail, { runtimePlatform, env, signal });
      const metadata = await createScreenshotMetadataAsync(thumbnail, {
        source: job.metadata.source,
        ...(job.metadata.displayRotation ? { displayRotation: job.metadata.displayRotation } : {}),
        logger,
      });
      await uploadDeviceRunSessionArtifactAsync(ctx, {
        ...job.artifact,
        artifactId: `${job.artifact.artifactId}-thumbnail`,
        name: `${job.artifact.name} thumbnail`,
        filename: `${path.parse(job.artifact.filename).name}.thumbnail.webp`,
        kind: SCREENSHOT_THUMBNAIL_KIND,
        metadata: {
          ...metadata,
          __eas_type: SCREENSHOT_THUMBNAIL_KIND,
          thumbnailKey: job.thumbnailKey,
        },
        size: (await stat(thumbnail)).size,
        openStream: () => createReadStream(thumbnail),
        attempts: 1,
        signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      if (isMissingCommandError(err)) {
        await disableAsync(
          err,
          `${encoderName(runtimePlatform)} is not available. The website shows full screenshots for this session.`
        );
        return;
      }
      logger.warn(
        { err, artifactId: job.artifact.artifactId },
        'Could not create or upload a small copy of a screenshot. The website shows the full screenshot.'
      );
    } finally {
      await Promise.all([rm(job.source, { force: true }), rm(thumbnail, { force: true })]);
    }
  };

  const runAsync = async (): Promise<void> => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (disabled || controller.signal.aborted) {
        await rm(job.source, { force: true });
        continue;
      }
      await processAsync(job);
    }
  };

  const startRunning = (): void => {
    if (running) {
      return;
    }
    running = runAsync()
      .catch(err => {
        logger.warn({ err }, 'The small screenshot copy queue stopped unexpectedly.');
      })
      .finally(() => {
        running = undefined;
        if (queue.length > 0 && !controller.signal.aborted) {
          startRunning();
        }
      });
  };

  return {
    async addAsync({ file, thumbnailKey, artifact, metadata }) {
      if (!accepting || disabled) {
        return;
      }
      if (queue.length >= MAX_QUEUED_THUMBNAILS) {
        skippedAsFull++;
        return;
      }
      try {
        directory ??= mkdtemp(path.join(os.tmpdir(), 'screenshot-thumbnails-'));
        const source = path.join(await directory, `${thumbnailKey}${path.extname(file)}`);
        await copyFile(file, source);
        if (!accepting || disabled) {
          await rm(source, { force: true });
          return;
        }
        queue.push({ source, thumbnailKey, artifact, metadata });
        startRunning();
      } catch (err) {
        logger.warn(
          { err, file },
          'Could not queue a small copy of a screenshot. The website shows the full screenshot.'
        );
      }
    },
    closeAsync(timeoutMs = THUMBNAIL_CLOSE_TIMEOUT_MS) {
      closeTask ??= (async () => {
        accepting = false;
        if (running && timeoutMs > 0) {
          let timer: NodeJS.Timeout | undefined;
          await Promise.race([
            running,
            new Promise<void>(resolve => {
              timer = setTimeout(resolve, timeoutMs);
            }),
          ]);
          clearTimeout(timer);
        }
        const cancelled = queue.length + (running ? 1 : 0);
        controller.abort();
        await running;
        await removeQueuedFilesAsync();
        if (cancelled > 0) {
          logger.info(
            `Cancelled ${cancelled} small screenshot ${cancelled === 1 ? 'copy' : 'copies'} at the end of the session. The website shows the full screenshots.`
          );
        }
        if (skippedAsFull > 0) {
          logger.warn(
            `Skipped ${skippedAsFull} small screenshot ${skippedAsFull === 1 ? 'copy' : 'copies'} because ${MAX_QUEUED_THUMBNAILS} copies were waiting. The website shows the full screenshots.`
          );
        }
        if (directory) {
          try {
            await rm(await directory, { recursive: true, force: true });
          } catch {
            // The directory was not created, or it is already removed.
          }
        }
      })();
      return closeTask;
    },
  };
}

/**
 * Uploads a screenshot. When it is wider than 480 px and a thumbnail queue is given, the queue
 * then makes and uploads a small WebP copy for the website lists. The copy is a separate
 * `screenshot-thumbnail` artifact. The screenshot and its copy have the same random
 * `metadata.thumbnailKey`, which links them. Only a failed screenshot upload rejects.
 */
export async function uploadDeviceRunSessionScreenshotAsync(
  ctx: CustomBuildContext,
  {
    file,
    metadata,
    thumbnails,
    attempts,
    signal,
    ...artifact
  }: Omit<ArtifactMetadata, 'metadata'> & {
    file: string;
    metadata: ScreenshotMetadata & Record<string, unknown>;
    thumbnails?: ScreenshotThumbnails;
    attempts?: number;
    signal?: AbortSignal;
  }
): Promise<void> {
  const upload = {
    ...artifact,
    ...(attempts ? { attempts } : {}),
    ...(signal ? { signal } : {}),
    openStream: () => createReadStream(file),
  };
  if (!thumbnails || !metadata.width || metadata.width <= THUMBNAIL_MAX_WIDTH) {
    await uploadDeviceRunSessionArtifactAsync(ctx, { ...upload, metadata });
    return;
  }

  // A key without a matching copy is safe: the website then shows the full screenshot.
  const thumbnailKey = randomUUID();
  await uploadDeviceRunSessionArtifactAsync(ctx, {
    ...upload,
    metadata: { ...metadata, thumbnailKey },
  });
  if (!signal?.aborted) {
    await thumbnails.addAsync({ file, thumbnailKey, artifact, metadata });
  }
}

function encoderName(runtimePlatform: BuildRuntimePlatform): string {
  return runtimePlatform === BuildRuntimePlatform.DARWIN ? 'cwebp' : 'FFmpeg';
}

function isMissingCommandError(err: unknown): boolean {
  const error = err as NodeJS.ErrnoException | undefined;
  return error?.code === 'ENOENT' && (error.syscall?.startsWith('spawn') ?? false);
}

async function encodeThumbnailAsync(
  source: string,
  destination: string,
  {
    runtimePlatform,
    env,
    signal,
  }: ScreenshotThumbnailEncoder & {
    signal: AbortSignal;
  }
): Promise<void> {
  const options = { env, stdio: 'pipe' as const, timeout: THUMBNAIL_ENCODE_TIMEOUT_MS, signal };
  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    await spawn(
      'cwebp',
      [
        '-quiet',
        '-q',
        String(THUMBNAIL_QUALITY),
        '-resize',
        String(THUMBNAIL_MAX_WIDTH),
        '0',
        source,
        '-o',
        destination,
      ],
      options
    );
    return;
  }
  await spawn(
    'ffmpeg',
    [
      '-nostdin',
      '-y',
      '-i',
      source,
      '-vf',
      `scale=${THUMBNAIL_MAX_WIDTH}:-1`,
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
      '-quality',
      String(THUMBNAIL_QUALITY),
      destination,
    ],
    options
  );
}
