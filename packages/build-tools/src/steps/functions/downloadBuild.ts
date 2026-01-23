import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import stream from 'stream';
import { promisify } from 'util';

import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import { asyncResult } from '@expo/results';
import fetch from 'node-fetch';
import { glob } from 'fast-glob';
import { z } from 'zod';
import { bunyan } from '@expo/logger';
import { UserFacingError } from '@expo/eas-build-job/dist/errors';

import { retryOnDNSFailure } from '../../utils/retryOnDNSFailure';
import { formatBytes } from '../../utils/artifacts';
import { decompressTarAsync, isFileTarGzAsync } from '../../utils/files';
import { pluralize } from '../../utils/strings';

const streamPipeline = promisify(stream.pipeline);

export function createDownloadBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'download_build',
    name: 'Download build',
    __metricsId: 'eas/download_build',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'build_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'extensions',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        defaultValue: ['apk', 'aab', 'ipa', 'app'],
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'artifact_path',
        required: true,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs }) => {
      const { logger } = stepsCtx;

      const extensions = z.array(z.string()).parse(inputs.extensions.value);
      logger.info(`Expected extensions: [${extensions.join(', ')}]`);
      const buildId = z.string().uuid().parse(inputs.build_id.value);
      logger.info(`Downloading build ${buildId}...`);

      const { artifactPath } = await downloadBuildAsync({
        logger,
        buildId,
        expoApiServerURL: stepsCtx.global.staticContext.expoApiServerURL,
        robotAccessToken: stepsCtx.global.staticContext.job.secrets?.robotAccessToken ?? null,
        extensions,
      });

      outputs.artifact_path.set(artifactPath);
    },
  });
}

export async function downloadBuildAsync({
  logger,
  buildId,
  expoApiServerURL,
  robotAccessToken,
  extensions,
}: {
  logger: bunyan;
  buildId: string;
  expoApiServerURL: string;
  robotAccessToken: string | null;
  extensions: string[];
}): Promise<{ artifactPath: string }> {
  const downloadDestinationDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'download_build-downloaded-')
  );

  const response = await retryOnDNSFailure(fetch)(
    new URL(`/v2/artifacts/eas/${buildId}`, expoApiServerURL),
    {
      headers: robotAccessToken ? { Authorization: `Bearer ${robotAccessToken}` } : undefined,
    }
  );

  if (!response.ok) {
    const textResult = await asyncResult(response.text());
    throw new Error(`Unexpected response from server (${response.status}): ${textResult.value}`);
  }

  // URL may contain percent-encoded characters, e.g. my%20file.apk
  // this replaces all non-alphanumeric characters (excluding dot) with underscore
  const archiveFilename = path
    .basename(new URL(response.url).pathname)
    .replace(/([^a-z0-9.-]+)/gi, '_');
  const archivePath = path.join(downloadDestinationDirectory, archiveFilename);

  await streamPipeline(response.body, fs.createWriteStream(archivePath));

  const { size } = await fs.promises.stat(archivePath);

  logger.info(`Downloaded ${archivePath} (${formatBytes(size)} bytes).`);

  const isFileATarGzArchive = await isFileTarGzAsync(archivePath);

  if (!isFileATarGzArchive) {
    logger.info(`Artifact is not a .tar.gz archive, skipping decompression and validation.`);
    return { artifactPath: archivePath };
  }

  const extractionDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'download_build-extracted-')
  );
  await decompressTarAsync({
    archivePath,
    destinationDirectory: extractionDirectory,
  });

  const matchingFiles = await glob(`**/*.(${extensions.join('|')})`, {
    absolute: true,
    cwd: extractionDirectory,
    onlyFiles: false,
    onlyDirectories: false,
  });

  if (matchingFiles.length === 0) {
    throw new UserFacingError(
      'EAS_DOWNLOAD_BUILD_NO_MATCHING_FILES',
      `No ${extensions.map((ext) => `.${ext}`).join(', ')} entries found in the archive.`
    );
  }

  logger.info(
    `Found ${matchingFiles.length} matching ${pluralize(matchingFiles.length, 'entry')}:\n${matchingFiles.map((f) => `- ${path.relative(extractionDirectory, f)}`).join('\n')}`
  );

  return { artifactPath: matchingFiles[0] };
}
