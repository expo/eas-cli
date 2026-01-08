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
import { z } from 'zod';
import { bunyan } from '@expo/logger';
import { UserFacingError } from '@expo/eas-build-job/dist/errors';

import { retryOnDNSFailure } from '../../utils/retryOnDNSFailure';
import { formatBytes } from '../../utils/artifacts';
import { decompressTarAsync, isFileTarGzAsync } from '../../utils/files';

const streamPipeline = promisify(stream.pipeline);

export function createDownloadArtifactFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'download_artifact',
    name: 'Download artifact',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'name',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'artifact_id',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'artifact_path',
        required: true,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs }) => {
      const params = z
        .union([z.object({ artifactId: z.string() }), z.object({ name: z.string() })])
        .parse({
          artifactId: inputs.artifact_id.value,
          name: inputs.name.value,
        });

      const interpolationContext = stepsCtx.global.getInterpolationContext();

      if (!('workflow' in interpolationContext)) {
        throw new UserFacingError(
          'EAS_DOWNLOAD_ARTIFACT_NO_WORKFLOW',
          'No workflow found in the interpolation context.'
        );
      }

      const robotAccessToken = stepsCtx.global.staticContext.job.secrets?.robotAccessToken;
      if (!robotAccessToken) {
        throw new UserFacingError(
          'EAS_DOWNLOAD_ARTIFACT_NO_ROBOT_ACCESS_TOKEN',
          'No robot access token found in the job secrets.'
        );
      }

      const workflowRunId = interpolationContext.workflow.id;
      const { logger } = stepsCtx;

      if ('artifactId' in params) {
        logger.info(`Downloading artifact with ID "${params.artifactId}"...`);
      } else {
        logger.info(`Downloading artifact with name "${params.name}"...`);
      }

      const { artifactPath } = await downloadArtifactAsync({
        logger,
        workflowRunId,
        expoApiServerURL: stepsCtx.global.staticContext.expoApiServerURL,
        robotAccessToken,
        params,
      });

      outputs.artifact_path.set(artifactPath);
    },
  });
}

export async function downloadArtifactAsync({
  logger,
  workflowRunId,
  expoApiServerURL,
  robotAccessToken,
  params,
}: {
  logger: bunyan;
  workflowRunId: string;
  expoApiServerURL: string;
  robotAccessToken: string;
  params: { artifactId: string } | { name: string };
}): Promise<{ artifactPath: string }> {
  const downloadDestinationDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'download_artifact-')
  );

  const url = new URL(`/v2/workflows/${workflowRunId}/download-artifact`, expoApiServerURL);

  if ('artifactId' in params) {
    url.searchParams.set('artifactId', params.artifactId);
  } else {
    url.searchParams.set('name', params.name);
  }

  const response = await retryOnDNSFailure(fetch)(url, {
    headers: robotAccessToken ? { Authorization: `Bearer ${robotAccessToken}` } : undefined,
  });

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
    path.join(os.tmpdir(), 'download_artifact-extracted-')
  );
  await decompressTarAsync({
    archivePath,
    destinationDirectory: extractionDirectory,
  });

  return { artifactPath: extractionDirectory };
}
