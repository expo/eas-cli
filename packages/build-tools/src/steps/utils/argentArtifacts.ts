import { SystemError } from '@expo/eas-build-job';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import fetch from 'node-fetch';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';

import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { formatBytes } from '../../utils/artifacts';
import { sleepAsync } from '../../utils/retry';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const ARGENT_ARTIFACT_UPLOAD_POLL_INTERVAL_MS = 5_000;

const ArgentArtifactSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  isDirectory: z.boolean().optional(),
});
const ArgentArtifactsListResponseSchema = z.object({
  artifacts: z.array(ArgentArtifactSchema),
});

type ArgentArtifact = z.infer<typeof ArgentArtifactSchema>;

export async function pollArgentArtifactsForUploadAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    toolsUrl,
    toolsAuthToken,
  }: {
    deviceRunSessionId: string;
    toolsUrl: string;
    toolsAuthToken?: string;
  }
): Promise<never> {
  const { logger } = ctx;
  logger.info('Started polling Argent tool-server for artifacts.');
  const seenArtifactIds = new Set<string>();
  let listArtifactsErrorCount = 0;

  for (;;) {
    try {
      const artifacts = await listArgentArtifactsAsync({ toolsUrl, toolsAuthToken });
      listArtifactsErrorCount = 0;
      for (const artifact of artifacts) {
        if (seenArtifactIds.has(artifact.id)) {
          continue;
        }
        seenArtifactIds.add(artifact.id);
        void uploadArgentArtifactAsync(ctx, {
          deviceRunSessionId,
          toolsUrl,
          toolsAuthToken,
          artifact,
        }).catch(err => {
          const error = err instanceof Error ? err : new Error(String(err));
          Sentry.capture('Could not upload Argent remote session artifact', error);
          logger.warn({ err: error }, 'Could not upload Argent remote session artifact.');
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      listArtifactsErrorCount += 1;
      if (listArtifactsErrorCount === 1 || listArtifactsErrorCount % 5 === 0) {
        Sentry.capture('Could not list Argent remote session artifacts', error);
        logger.warn(
          { err: error, failedArtifactListCount: listArtifactsErrorCount },
          'Could not list Argent remote session artifacts.'
        );
      }
    }
    await sleepAsync(ARGENT_ARTIFACT_UPLOAD_POLL_INTERVAL_MS);
  }
}

export async function listArgentArtifactsAsync({
  toolsUrl,
  toolsAuthToken,
}: {
  toolsUrl: string;
  toolsAuthToken?: string;
}): Promise<ArgentArtifact[]> {
  const response = await fetch(new URL('/artifacts', toolsUrl).toString(), {
    headers: toolsAuthToken ? { Authorization: `Bearer ${toolsAuthToken}` } : {},
  });
  if (!response.ok) {
    throw new SystemError(
      `Failed to list Argent artifacts: ${response.status} ${response.statusText}`
    );
  }
  const result = ArgentArtifactsListResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SystemError(`Invalid Argent artifacts response: ${result.error.message}`);
  }
  return result.data.artifacts;
}

export async function uploadArgentArtifactAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    toolsUrl,
    toolsAuthToken,
    artifact,
  }: {
    deviceRunSessionId: string;
    toolsUrl: string;
    toolsAuthToken?: string;
    artifact: ArgentArtifact;
  }
): Promise<void> {
  const filename = artifact.isDirectory ? `${artifact.filename}.tar.gz` : artifact.filename;
  const { logger } = ctx;
  logger.info(`Downloading artifact ${filename}.`);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'argent-artifact-'));
  try {
    const temporaryArtifactPath = path.join(temporaryDirectory, path.basename(filename));
    await downloadArgentArtifactToFileAsync({
      artifact,
      toolsUrl,
      toolsAuthToken,
      destinationPath: temporaryArtifactPath,
    });
    const { size } = await stat(temporaryArtifactPath);
    logger.info(`Uploading artifact ${filename} (${formatBytes(size)}).`);
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: artifact.id,
      name: `${filename} (${artifact.id})`,
      filename,
      size,
      stream: createReadStream(temporaryArtifactPath),
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function downloadArgentArtifactToFileAsync({
  artifact,
  toolsUrl,
  toolsAuthToken,
  destinationPath,
}: {
  artifact: ArgentArtifact;
  toolsUrl: string;
  toolsAuthToken?: string;
  destinationPath: string;
}): Promise<void> {
  const response = await fetch(new URL(`/artifacts/${artifact.id}`, toolsUrl).toString(), {
    headers: toolsAuthToken ? { Authorization: `Bearer ${toolsAuthToken}` } : {},
  });
  if (!response.ok) {
    throw new SystemError(
      `Failed to download Argent artifact ${artifact.id}: ${response.status} ${response.statusText}`
    );
  }
  if (!response.body) {
    throw new SystemError(
      `Argent artifact ${artifact.id} response did not include a readable body.`
    );
  }
  await pipeline(response.body, createWriteStream(destinationPath));
}
