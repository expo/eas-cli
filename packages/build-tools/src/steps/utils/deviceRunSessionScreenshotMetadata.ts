import type { bunyan } from '@expo/logger';
import { open } from 'node:fs/promises';

const IMAGE_HEADER_MAX_BYTES = 64 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ScreenshotSource = 'manual' | 'agent-device';

export type ScreenshotMetadata = {
  source: ScreenshotSource;
  width?: number;
  height?: number;
  displayRotation?: string;
};

type ImageSize = { width: number; height: number };

export async function createScreenshotMetadataAsync(
  file: string,
  { logger, ...metadata }: Omit<ScreenshotMetadata, 'width' | 'height'> & { logger: bunyan }
): Promise<ScreenshotMetadata> {
  try {
    const size = await readImageFileSizeAsync(file);
    if (size) {
      return { ...metadata, ...size };
    }
    logger.warn(
      { file },
      'Uploading the screenshot without its width and height because it does not start with a complete PNG, WebP or JPEG header.'
    );
  } catch (err) {
    logger.warn(
      { err, file },
      'Uploading the screenshot without its width and height because its header could not be read.'
    );
  }
  return metadata;
}

async function readImageFileSizeAsync(file: string): Promise<ImageSize | undefined> {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(
      Buffer.alloc(IMAGE_HEADER_MAX_BYTES),
      0,
      IMAGE_HEADER_MAX_BYTES,
      0
    );
    return readImageSize(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export function readImageSize(header: Buffer): ImageSize | undefined {
  const size = readPngSize(header) ?? readWebpSize(header) ?? readJpegSize(header);
  return size && size.width > 0 && size.height > 0 ? size : undefined;
}

function readPngSize(header: Buffer): ImageSize | undefined {
  if (
    header.length < 24 ||
    !header.subarray(0, 8).equals(PNG_SIGNATURE) ||
    header.toString('latin1', 12, 16) !== 'IHDR'
  ) {
    return undefined;
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function readWebpSize(header: Buffer): ImageSize | undefined {
  if (
    header.length < 16 ||
    header.toString('latin1', 0, 4) !== 'RIFF' ||
    header.toString('latin1', 8, 12) !== 'WEBP'
  ) {
    return undefined;
  }
  switch (header.toString('latin1', 12, 16)) {
    case 'VP8 ':
      if (header.length < 30 || header.readUIntBE(23, 3) !== 0x9d012a) {
        return undefined;
      }
      return {
        width: header.readUInt16LE(26) & 0x3fff,
        height: header.readUInt16LE(28) & 0x3fff,
      };
    case 'VP8L': {
      if (header.length < 25 || header[20] !== 0x2f) {
        return undefined;
      }
      const bits = header.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case 'VP8X':
      if (header.length < 30) {
        return undefined;
      }
      return { width: header.readUIntLE(24, 3) + 1, height: header.readUIntLE(27, 3) + 1 };
    default:
      return undefined;
  }
}

function readJpegSize(header: Buffer): ImageSize | undefined {
  if (header.length < 4 || header[0] !== 0xff || header[1] !== 0xd8) {
    return undefined;
  }
  let offset = 2;
  while (offset + 4 <= header.length) {
    if (header[offset] !== 0xff) {
      return undefined;
    }
    const marker = header[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return undefined;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentEnd = offset + 2 + header.readUInt16BE(offset + 2);
    if (segmentEnd < offset + 4) {
      return undefined;
    }
    if (isJpegStartOfFrame(marker)) {
      return segmentEnd <= header.length
        ? readJpegFrameSize(header.subarray(offset + 4, segmentEnd))
        : undefined;
    }
    offset = segmentEnd;
  }
  return undefined;
}

function readJpegFrameSize(frame: Buffer): ImageSize | undefined {
  if (frame.length < 6 || frame[5] === 0 || frame.length !== 6 + 3 * frame[5]) {
    return undefined;
  }
  return { width: frame.readUInt16BE(3), height: frame.readUInt16BE(1) };
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}
