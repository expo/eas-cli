import spawnAsync from '@expo/spawn-async';
import glob from 'fast-glob';
import fs from 'fs';
import path from 'path';
import { Stream } from 'stream';
import { extract } from 'tar';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

import fetch, { RequestInit } from '../fetch';
import { AppPlatform } from '../graphql/generated';
import Log from '../log';
import { formatBytes } from './files';
import { getTmpDirectory } from './paths';
import { ProgressHandler, createProgressTracker } from './progress';

const pipeline = promisify(Stream.pipeline);

let didProgressBarFinish = false;

function wrapFetchWithProgress() {
  return async (url: string, init: RequestInit, progressHandler: ProgressHandler) => {
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

        if (!didProgressBarFinish) {
          progressHandler({
            progress: { total, percent: progress, transferred: length },
            isComplete: total === length,
          });
          if (total === length) {
            didProgressBarFinish = true;
          }
        }
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

async function downloadFileWithProgressTrackerAsync(
  url: string,
  outputPath: string,
  progressTrackerMessage: string | ((ratio: number, total: number) => string),
  progressTrackerCompletedMessage: string
): Promise<void> {
  Log.newLine();

  const response = await wrapFetchWithProgress()(
    url,
    {
      timeout: 1000 * 60 * 5, // 5 minutes
    },
    createProgressTracker({
      message: progressTrackerMessage,
      completedMessage: progressTrackerCompletedMessage,
    })
  );

  if (!response.ok) {
    throw new Error(`Failed to download file from ${url}`);
  }

  await pipeline(response.body, fs.createWriteStream(outputPath));
}

export async function downloadAndMaybeExtractAppAsync(
  url: string,
  platform: AppPlatform
): Promise<string> {
  const outputDir = path.join(getTmpDirectory(), uuidv4());
  await fs.promises.mkdir(outputDir, { recursive: true });

  if (url.endsWith('apk')) {
    const apkFilePath = path.join(outputDir, `${uuidv4()}.apk`);
    await downloadFileWithProgressTrackerAsync(
      url,
      apkFilePath,
      (ratio, total) => `Downloading app (${formatBytes(total * ratio)} / ${formatBytes(total)})`,
      'Successfully downloaded app'
    );
    return apkFilePath;
  } else {
    const tmpArchivePathDir = path.join(getTmpDirectory(), uuidv4());
    await fs.promises.mkdir(tmpArchivePathDir, { recursive: true });

    const tmpArchivePath = path.join(tmpArchivePathDir, `${uuidv4()}.tar.gz`);

    await downloadFileWithProgressTrackerAsync(
      url,
      tmpArchivePath,
      (ratio, total) =>
        `Downloading app archive (${formatBytes(total * ratio)} / ${formatBytes(total)})`,
      'Successfully downloaded app archive'
    );
    await tarExtractAsync(tmpArchivePath, outputDir);

    return await getAppPathAsync(outputDir, platform === AppPlatform.Ios ? 'app' : 'apk');
  }
}

export async function extractAppFromLocalArchiveAsync(
  appArchivePath: string,
  platform: AppPlatform
): Promise<string> {
  const outputDir = path.join(getTmpDirectory(), uuidv4());
  await fs.promises.mkdir(outputDir, { recursive: true });

  await tarExtractAsync(appArchivePath, outputDir);

  return await getAppPathAsync(outputDir, platform === AppPlatform.Android ? 'apk' : 'app');
}

async function getAppPathAsync(outputDir: string, applicationExtension: string): Promise<string> {
  const appFileName = await glob(`*.${applicationExtension}`, {
    cwd: outputDir,
    onlyFiles: false,
  });

  if (appFileName.length === 0) {
    throw Error('Something went wrong while extracting the app from app archive');
  }

  return path.join(outputDir, appFileName[0]);
}

async function tarExtractAsync(input: string, output: string): Promise<void> {
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
