import fs from 'fs-extra';
import { Metadata, PNG } from 'pngjs';

import fetch from '../fetch';

export class ImageNonPngError extends Error {}
export class ImageTransparencyError extends Error {}

export async function ensurePNGIsNotTransparentAsync(imagePathOrURL: string): Promise<void> {
  let hasAlreadyResolved = false;
  const stream = await getImageStreamAsync(imagePathOrURL);
  let metadata: Metadata | undefined;

  await new Promise<void>((res, rej) => {
    stream
      .pipe(new PNG({ filterType: 4 }))
      .on('error', err => {
        if (err.message.match(/Invalid file signature/)) {
          rej(new ImageNonPngError());
        } else {
          rej(err);
        }
      })
      .on('metadata', _metadata => {
        metadata = _metadata;
        const { alpha } = metadata;
        if (!alpha) {
          hasAlreadyResolved = true;
          if (stream instanceof fs.ReadStream) {
            stream.close();
          }
          res();
        }
      })
      .on('parsed', (png: Buffer) => {
        if (hasAlreadyResolved) {
          return;
        }
        try {
          // metadata should be set but assume the png is fine if it's not available
          if (!metadata) {
            res();
            return;
          }
          validateAlphaChannelIsEmpty(png, { width: metadata.width, height: metadata.height });
          res();
        } catch (err: any) {
          rej(err);
        }
      });
  });
}

export async function isPNGAsync(imagePathOrURL: string): Promise<boolean> {
  const stream = await getImageStreamAsync(imagePathOrURL);
  return await new Promise((res, rej) => {
    stream
      .pipe(new PNG({ filterType: 4 }))
      .on('error', err => {
        if (err.message.match(/Invalid file signature/)) {
          res(false);
        } else {
          rej(err);
        }
      })
      .on('parsed', () => {
        res(true);
      });
  });
}

async function getImageStreamAsync(imagePathOrURL: string): Promise<NodeJS.ReadableStream> {
  if (isURL(imagePathOrURL)) {
    const response = await fetch(imagePathOrURL);
    return response.body;
  } else {
    return fs.createReadStream(imagePathOrURL);
  }
}

function isURL(imagePathOrURL: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(imagePathOrURL);
    return true;
  } catch {
    return false;
  }
}

function validateAlphaChannelIsEmpty(
  data: Buffer,
  { width, height }: { width: number; height: number }
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;
      if (data[idx + 3] !== 255) {
        throw new ImageTransparencyError();
      }
    }
  }
}
