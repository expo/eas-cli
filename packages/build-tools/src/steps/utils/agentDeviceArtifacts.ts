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
import { sleepAsync } from '../../utils/retry';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const AGENT_DEVICE_ARTIFACT_UPLOAD_POLL_INTERVAL_MS = 5_000;

const AgentDeviceArtifactSchema = z.object({
  id: z.string(),
  artifactType: z.string().nullish(),
  filename: z.string(),
});
const AgentDeviceArtifactsListResponseSchema = z.object({
  artifacts: z.array(AgentDeviceArtifactSchema),
});

export type AgentDeviceArtifact = z.infer<typeof AgentDeviceArtifactSchema>;

class AgentDeviceArtifactsUnsupportedError extends SystemError {
  constructor() {
    super('agent-device daemon does not expose artifact inventory.');
  }
}

export async function pollAgentDeviceArtifactsForUploadAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    daemonUrl,
    daemonToken,
    logger,
  }: {
    deviceRunSessionId: string;
    daemonUrl: string;
    daemonToken: string;
    logger: bunyan;
  }
): Promise<void> {
  logger.info('Started polling agent-device daemon for artifacts.');
  const uploadedArtifactIds = new Set<string>();
  let listArtifactsErrorCount = 0;

  for (;;) {
    try {
      const artifacts = await listAgentDeviceArtifactsAsync({ daemonUrl, daemonToken });
      listArtifactsErrorCount = 0;
      for (const artifact of artifacts) {
        if (uploadedArtifactIds.has(artifact.id)) {
          continue;
        }
        try {
          await uploadAgentDeviceArtifactAsync(ctx, {
            deviceRunSessionId,
            daemonUrl,
            daemonToken,
            artifact,
            logger,
          });
          uploadedArtifactIds.add(artifact.id);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          Sentry.capture('Could not upload agent-device remote session artifact', error);
          logger.warn({ err: error }, 'Could not upload agent-device remote session artifact.');
        }
      }
    } catch (err) {
      if (err instanceof AgentDeviceArtifactsUnsupportedError) {
        logger.warn(
          'agent-device daemon does not expose artifact inventory; remote session artifact uploads are disabled.'
        );
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      listArtifactsErrorCount += 1;
      if (listArtifactsErrorCount === 1 || listArtifactsErrorCount % 5 === 0) {
        Sentry.capture('Could not list agent-device remote session artifacts', error);
        logger.warn(
          { err: error, failedArtifactListCount: listArtifactsErrorCount },
          'Could not list agent-device remote session artifacts.'
        );
      }
    }
    await sleepAsync(AGENT_DEVICE_ARTIFACT_UPLOAD_POLL_INTERVAL_MS);
  }
}

export async function listAgentDeviceArtifactsAsync({
  daemonUrl,
  daemonToken,
}: {
  daemonUrl: string;
  daemonToken: string;
}): Promise<AgentDeviceArtifact[]> {
  const response = await fetch(new URL('/artifacts', daemonUrl).toString(), {
    headers: { Authorization: `Bearer ${daemonToken}` },
  });
  if (response.status === 404) {
    throw new AgentDeviceArtifactsUnsupportedError();
  }
  if (!response.ok) {
    throw new SystemError(
      `Failed to list agent-device artifacts: ${response.status} ${response.statusText}`
    );
  }
  const result = AgentDeviceArtifactsListResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SystemError(`Invalid agent-device artifacts response: ${result.error.message}`);
  }
  return result.data.artifacts;
}

export async function uploadAgentDeviceArtifactAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    daemonUrl,
    daemonToken,
    artifact,
    logger,
  }: {
    deviceRunSessionId: string;
    daemonUrl: string;
    daemonToken: string;
    artifact: AgentDeviceArtifact;
    logger: bunyan;
  }
): Promise<void> {
  logger.info(`Downloading artifact ${artifact.filename}.`);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'agent-device-artifact-'));
  try {
    const temporaryArtifactPath = path.join(temporaryDirectory, path.basename(artifact.filename));
    await downloadAgentDeviceArtifactToFileAsync({
      artifact,
      daemonUrl,
      daemonToken,
      destinationPath: temporaryArtifactPath,
    });
    const { size } = await stat(temporaryArtifactPath);
    logger.info(`Uploading artifact ${artifact.filename} (${formatBytes(size)}).`);
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: artifact.id,
      name: `${artifact.filename} (${artifact.id})`,
      filename: artifact.filename,
      kind: artifact.artifactType ?? undefined,
      size,
      stream: createReadStream(temporaryArtifactPath),
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function downloadAgentDeviceArtifactToFileAsync({
  artifact,
  daemonUrl,
  daemonToken,
  destinationPath,
}: {
  artifact: AgentDeviceArtifact;
  daemonUrl: string;
  daemonToken: string;
  destinationPath: string;
}): Promise<void> {
  const response = await fetch(
    new URL(`/artifacts/${encodeURIComponent(artifact.id)}`, daemonUrl).toString(),
    {
      headers: { Authorization: `Bearer ${daemonToken}` },
    }
  );
  if (!response.ok) {
    throw new SystemError(
      `Failed to download agent-device artifact ${artifact.id}: ${response.status} ${response.statusText}`
    );
  }
  if (!response.body) {
    throw new SystemError(
      `Agent-device artifact ${artifact.id} response did not include a readable body.`
    );
  }
  await pipeline(response.body, createWriteStream(destinationPath));
}
