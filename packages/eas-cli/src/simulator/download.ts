import fs from 'fs-extra';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { type Response } from '../fetch';

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export async function downloadSimulatorFileAsync(
  output: string,
  getResponse: (signal: AbortSignal) => Promise<Response>
): Promise<string> {
  const outputPath = path.resolve(output);
  if (await fs.pathExists(outputPath)) {
    throw new Error(
      'The output file already exists. The command does not overwrite files. Choose another --output path.'
    );
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]);
  const interruptHandler = (): void => {
    controller.abort();
  };
  let response: Response | undefined;
  let created = false;
  process.on('SIGINT', interruptHandler);
  try {
    response = await getResponse(signal);
    const file = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
    file.once('open', () => {
      created = true;
    });
    await pipeline(response.body, file, { signal });
    return outputPath;
  } catch (error) {
    if (created) {
      await fs.remove(outputPath);
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        'The output file already exists. The command does not overwrite files. Choose another --output path.'
      );
    }
    if (controller.signal.aborted) {
      throw new Error('The download was canceled.');
    }
    if (signal.aborted) {
      throw new Error(
        'The download timed out. It did not finish within 10 minutes. Check your internet connection, then run the command again.'
      );
    }
    if (!response) {
      throw error;
    }
    throw new Error(
      'Could not save the download. Check that the --output directory exists and is writable, then try again.'
    );
  } finally {
    controller.abort();
    process.removeListener('SIGINT', interruptHandler);
  }
}
