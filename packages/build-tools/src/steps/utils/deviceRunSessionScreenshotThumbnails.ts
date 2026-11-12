import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CustomBuildContext } from '../../customBuildContext';
import {
  type ArtifactMetadata,
  uploadDeviceRunSessionArtifactAsync,
} from './deviceRunSessionArtifacts';
import {
  type ScreenshotMetadata,
  createScreenshotMetadataAsync,
} from './deviceRunSessionScreenshotMetadata';

export const SCREENSHOT_THUMBNAIL_KIND = 'screenshot-thumbnail';
const THUMBNAIL_MAX_WIDTH = 480;
const THUMBNAIL_QUALITY = 70;
const THUMBNAIL_ENCODE_TIMEOUT_MS = 30_000;

/** The runtime that encodes thumbnails: `cwebp` on macOS, FFmpeg with libwebp on Linux. */
export type ScreenshotThumbnailEncoder = {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
};

/**
 * Uploads a screenshot. When it is wider than 480 px and an encoder is given, it also uploads a
 * small WebP copy for the website lists. The copy is a separate `screenshot-thumbnail` artifact.
 * The screenshot and its copy have the same random `metadata.thumbnailKey`, which links them.
 * A copy that cannot be made or uploaded is skipped, and the website shows the full screenshot.
 */
export async function uploadDeviceRunSessionScreenshotAsync(
  ctx: CustomBuildContext,
  {
    file,
    metadata,
    thumbnailEncoder,
    logger,
    attempts,
    signal,
    ...artifact
  }: Omit<ArtifactMetadata, 'metadata'> & {
    file: string;
    metadata: ScreenshotMetadata & Record<string, unknown>;
    thumbnailEncoder?: ScreenshotThumbnailEncoder;
    logger: bunyan;
    attempts?: number;
    signal?: AbortSignal;
  }
): Promise<void> {
  const upload = { ...artifact, ...(attempts ? { attempts } : {}), ...(signal ? { signal } : {}) };
  if (!thumbnailEncoder || !metadata.width || metadata.width <= THUMBNAIL_MAX_WIDTH) {
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      ...upload,
      metadata,
      openStream: () => createReadStream(file),
    });
    return;
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'screenshot-thumbnail-'));
  try {
    const thumbnail = path.join(directory, 'thumbnail.webp');
    let thumbnailCreated = false;
    try {
      await encodeThumbnailAsync(file, thumbnail, { ...thumbnailEncoder, signal });
      thumbnailCreated = true;
    } catch (err) {
      signal?.throwIfAborted();
      logger.warn(
        { err, file },
        'Could not create a small copy of the screenshot. The website uses the full screenshot.'
      );
    }
    const thumbnailKey = thumbnailCreated ? randomUUID() : undefined;
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      ...upload,
      metadata: thumbnailKey ? { ...metadata, thumbnailKey } : metadata,
      openStream: () => createReadStream(file),
    });
    if (!thumbnailKey) {
      return;
    }
    try {
      await uploadDeviceRunSessionArtifactAsync(ctx, {
        ...upload,
        artifactId: `${artifact.artifactId}-thumbnail`,
        name: `${artifact.name} thumbnail`,
        filename: `${path.parse(artifact.filename).name}.thumbnail.webp`,
        kind: SCREENSHOT_THUMBNAIL_KIND,
        metadata: {
          ...(await createScreenshotMetadataAsync(thumbnail, { source: metadata.source, logger })),
          __eas_type: SCREENSHOT_THUMBNAIL_KIND,
          thumbnailKey,
        },
        size: (await stat(thumbnail)).size,
        openStream: () => createReadStream(thumbnail),
      });
    } catch (err) {
      // The screenshot is already uploaded, so a failure here must not make the caller retry it.
      if (!signal?.aborted) {
        logger.warn(
          { err, file },
          'Could not upload the small copy of the screenshot. The website uses the full screenshot.'
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function encodeThumbnailAsync(
  source: string,
  destination: string,
  {
    runtimePlatform,
    env,
    signal,
  }: ScreenshotThumbnailEncoder & {
    signal?: AbortSignal;
  }
): Promise<void> {
  const options = {
    env,
    stdio: 'pipe' as const,
    timeout: THUMBNAIL_ENCODE_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
  };
  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    // Homebrew's FFmpeg has no libwebp, so macOS uses cwebp, as the session preview does.
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
