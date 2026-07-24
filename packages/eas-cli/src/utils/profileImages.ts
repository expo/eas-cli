import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { sleepAsync } from './promise';

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // matches the upload session's GCS limit
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

export async function validateProfileImageAsync(imagePath: string): Promise<void> {
  if (!(await fs.pathExists(imagePath))) {
    throw new Error(`No file found at ${imagePath}`);
  }
  const extension = path.extname(imagePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error(
      `Unsupported image format "${extension}". The image must be a PNG or JPEG file.`
    );
  }
  const { size } = await fs.stat(imagePath);
  if (size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `The image is ${(size / 1024 / 1024).toFixed(1)} MB, but the maximum allowed size is 10 MB.`
    );
  }
}

/**
 * Profile images are processed asynchronously (resized and assigned to their
 * entity by the server), so poll until the image URL changes.
 */
export async function pollForProfileImageChangeAsync({
  fetchProfileImageUrlAsync,
  previousProfileImageUrl,
  fallbackUrl,
}: {
  fetchProfileImageUrlAsync: () => Promise<string | null>;
  previousProfileImageUrl: string | null;
  /** Shown in the timeout error as the page where the image may still appear. */
  fallbackUrl: string;
}): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleepAsync(POLL_INTERVAL_MS);
    const profileImageUrl = await fetchProfileImageUrlAsync();
    if (profileImageUrl && profileImageUrl !== previousProfileImageUrl) {
      return;
    }
  }
  throw new Error(
    `Timed out waiting for the image to be processed. It may still appear shortly: ${chalk.underline(
      fallbackUrl
    )}`
  );
}
