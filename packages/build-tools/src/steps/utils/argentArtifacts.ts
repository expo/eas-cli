import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
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
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const ARGENT_ARTIFACT_UPLOAD_POLL_INTERVAL_MS = 5_000;
const ARGENT_ARTIFACT_UPLOAD_CLEANUP_TIMEOUT_MS = 30_000;

const ArgentArtifactSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
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
    logger,
    signal,
  }: {
    deviceRunSessionId: string;
    toolsUrl: string;
    toolsAuthToken?: string;
    logger: bunyan;
    signal: AbortSignal;
  }
): Promise<void> {
  logger.info('Started polling Argent tool-server for artifacts.');
  const seenArtifactIds = new Set<string>();
  const pendingUploads = new Set<Promise<void>>();
  let listArtifactsErrorCount = 0;

  const queueArtifactUpload = (artifact: ArgentArtifact): void => {
    if (seenArtifactIds.has(artifact.id)) {
      return;
    }
    seenArtifactIds.add(artifact.id);
    const uploadPromise = uploadArgentArtifactAsync(ctx, {
      deviceRunSessionId,
      toolsUrl,
      toolsAuthToken,
      artifact,
      logger,
    }).catch(err => {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('Could not upload Argent remote session artifact', error);
      logger.warn({ err: error }, 'Could not upload Argent remote session artifact.');
    });
    pendingUploads.add(uploadPromise);
    void uploadPromise.finally(() => {
      pendingUploads.delete(uploadPromise);
    });
  };

  const listArtifactsForUploadAsync = async (): Promise<ArgentArtifact[]> => {
    try {
      const artifacts = await listArgentArtifactsAsync({ toolsUrl, toolsAuthToken });
      listArtifactsErrorCount = 0;
      return artifacts;
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
      return [];
    }
  };

  const listAndQueueArtifactUploadsAsync = async (): Promise<void> => {
    const artifacts = await listArtifactsForUploadAsync();
    for (const artifact of artifacts) {
      queueArtifactUpload(artifact);
    }
  };

  while (!signal.aborted) {
    await listAndQueueArtifactUploadsAsync();
    await sleepUntilAbortedAsync(ARGENT_ARTIFACT_UPLOAD_POLL_INTERVAL_MS, signal);
  }

  logger.info('Argent artifact polling stopped; draining remaining artifacts.');
  await listAndQueueArtifactUploadsAsync();
  await waitForPendingUploadsAsync({
    pendingUploads,
    timeoutMs: ARGENT_ARTIFACT_UPLOAD_CLEANUP_TIMEOUT_MS,
    logger,
  });
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
    logger,
  }: {
    deviceRunSessionId: string;
    toolsUrl: string;
    toolsAuthToken?: string;
    artifact: ArgentArtifact;
    logger: bunyan;
  }
): Promise<void> {
  const filename = artifact.isDirectory ? `${artifact.filename}.tar.gz` : artifact.filename;
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
      kind: undefined,
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

async function sleepUntilAbortedAsync(timeoutMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>(resolve => {
    let timeout: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      signal.removeEventListener('abort', finish);
      resolve();
    };
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) {
      finish();
      return;
    }
    timeout = setTimeout(finish, timeoutMs);
  });
}

async function waitForPendingUploadsAsync({
  pendingUploads,
  timeoutMs,
  logger,
}: {
  pendingUploads: Set<Promise<void>>;
  timeoutMs: number;
  logger: bunyan;
}): Promise<void> {
  if (pendingUploads.size === 0) {
    return;
  }

  logger.info(`Waiting for ${pendingUploads.size} Argent artifact upload(s) to finish.`);
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...pendingUploads]),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new SystemError(
              `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Argent artifact uploads.`,
              {
                trackingCode: 'SIMULATOR_ARTIFACT_SLOW_UPLOAD',
              }
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
