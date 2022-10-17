import spawnAsync from '@expo/spawn-async';
import cliProgress from 'cli-progress';
import glob from 'fast-glob';
import fs from 'fs';
import fetch, { RequestInit } from 'node-fetch';
import path from 'path';
import { Stream } from 'stream';
import { extract } from 'tar';
import tempy from 'tempy';
import { promisify } from 'util';
import { v4 } from 'uuid';

import Log from '../log';

const pipeline = promisify(Stream.pipeline);

type ProgressCallback = (progress: number, total: number, loaded: number) => void;

function wrapFetchWithProgress() {
  return async (url: string, init: RequestInit, onProgressCallback: ProgressCallback) => {
    const response = await fetch(url, init);

    if (response.ok) {
      const totalDownloadSize = response.headers.get('Content-Length');
      const total = Number(totalDownloadSize);

      if (!totalDownloadSize || isNaN(total) || total < 0) {
        Log.warn(
          'Progress callback not supported for network request because "Content-Length" header missing or invalid in response from URL:',
          url.toString()
        );
        return response;
      }

      let length = 0;
      const onProgress = (chunkLength?: number): void => {
        if (chunkLength) {
          length += chunkLength;
        }

        const progress = length / total;

        onProgressCallback(progress, total, length);
      };

      response.body.on('data', chunk => {
        onProgress(chunk.length);
      });

      response.body.on('end', () => {
        onProgress();
      });
    }

    return response;
  };
}

async function downloadFileWithProgressBarAsync(
  url: string,
  outputPath: string,
  infoMessage?: string
): Promise<void> {
  Log.newLine();
  Log.log(infoMessage ? infoMessage : `Downloading file from ${url}...`);

  const downloadProgressBar = new cliProgress.SingleBar(
    { format: '|{bar}|' },
    cliProgress.Presets.rect
  );

  let downloadProgressBarStarted = false;
  const response = await wrapFetchWithProgress()(
    url,
    {
      timeout: 1000 * 60 * 5, // 5 minutes
    },
    (_progress: number, total: number, loaded: number): void => {
      if (!downloadProgressBarStarted) {
        downloadProgressBar.start(total, loaded);
        downloadProgressBarStarted = true;
      } else if (loaded < total) {
        downloadProgressBar.update(loaded);
      } else {
        downloadProgressBar.stop();
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to download file from ${url}`);
  }

  await pipeline(response.body, fs.createWriteStream(outputPath));
}

export async function downloadAndExtractAppAsync(
  url: string,
  applicationExtension: string
): Promise<string> {
  const outputDir = tempy.directory();

  const tmpArchivePath = tempy.file({ name: `${v4()}.tar.gz` });
  await downloadFileWithProgressBarAsync(url, tmpArchivePath, 'Downloading app archive...');
  await extractAsync(tmpArchivePath, outputDir);

  const appFileName = await glob(`*.${applicationExtension}`, {
    cwd: outputDir,
    onlyFiles: false,
  });

  if (appFileName.length === 0) {
    throw Error('Something went wrong while extracting the app from app archive');
  }

  return path.join(outputDir, appFileName[0]);
}

async function extractAsync(input: string, output: string): Promise<void> {
  try {
    if (process.platform !== 'win32') {
      await spawnAsync('tar', ['-xf', input, '-C', output], {
        stdio: 'inherit',
      });
      return;
    }
  } catch (error: any) {
    Log.warn(
      `Failed to extract tar using native tools, falling back on JS tar module. ${error.message}`
    );
  }
  Log.debug(`Extracting ${input} to ${output} using JS tar module`);
  // tar node module has previously had problems with big files, and seems to
  // be slower, so only use it as a backup.
  await extract({ file: input, cwd: output });
}
