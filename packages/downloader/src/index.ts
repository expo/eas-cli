import stream from 'stream';
import { promisify } from 'util';

import fs from 'fs-extra';
import got from 'got';

const pipeline = promisify(stream.pipeline);

async function downloadFile(
  srcUrl: string,
  outputPath: string,
  { retry, timeout }: { retry?: number; timeout?: number }
): Promise<void> {
  let attemptCount = 0;
  for (;;) {
    attemptCount += 1;
    try {
      await pipeline(got.stream(srcUrl, { timeout }), fs.createWriteStream(outputPath));
      return;
    } catch (err: any) {
      if (await fs.pathExists(outputPath)) {
        await fs.remove(outputPath);
      }
      if (attemptCount > (retry ?? 0)) {
        throw new Error(`Failed to download the file: ${err?.message}\n${err?.stack}`);
      }
    }
  }
}

export default downloadFile;
