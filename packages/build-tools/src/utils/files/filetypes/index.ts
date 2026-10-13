import { FileHandle } from 'node:fs/promises';
import { GIF_HEADER_BYTES, isGif } from './gif';
import { JPEG_HEADER_BYTES, isJpeg } from './jpeg';
import { PNG_HEADER_BYTES, isPng } from './png';
import { WEBP_HEADER_BYTES, isWebp } from './webp';
import { readBytesAsync } from '..';

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export const IMAGE_HEADER_BYTES = Math.max(
  JPEG_HEADER_BYTES,
  PNG_HEADER_BYTES,
  GIF_HEADER_BYTES,
  WEBP_HEADER_BYTES
);

export function detectFileTypeFromHeader(header: Buffer): ImageMimeType | null {
  if (isPng(header)) {
    return 'image/png';
  }
  if (isJpeg(header)) {
    return 'image/jpeg';
  }
  if (isGif(header)) {
    return 'image/gif';
  }
  if (isWebp(header)) {
    return 'image/webp';
  }
  return null;
}

export async function detectFileType(file: FileHandle): Promise<ImageMimeType | null> {
  const header = await readBytesAsync(file, IMAGE_HEADER_BYTES);
  return detectFileTypeFromHeader(header);
}
