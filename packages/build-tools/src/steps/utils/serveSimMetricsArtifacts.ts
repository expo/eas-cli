import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { formatBytes } from '../../utils/artifacts';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const METRICS_ARTIFACT_FILENAME = 'metrics.ndjson';

export async function uploadServeSimMetricsFileAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    udid,
    filePath,
    logger,
  }: {
    deviceRunSessionId: string;
    udid: string;
    filePath: string;
    logger: bunyan;
  }
): Promise<void> {
  let size: number;
  try {
    ({ size } = await stat(filePath));
  } catch {
    logger.info(`No serve-sim metrics captured for ${udid}; skipping upload.`);
    return;
  }
  if (size === 0) {
    logger.info(`No serve-sim metrics captured for ${udid}; skipping upload.`);
    return;
  }
  try {
    logger.info(`Uploading serve-sim metrics for ${udid} (${formatBytes(size)}).`);
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: `metrics-${udid}`,
      name: METRICS_ARTIFACT_FILENAME,
      filename: METRICS_ARTIFACT_FILENAME,
      kind: undefined,
      size,
      stream: createReadStream(filePath),
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not upload serve-sim metrics artifact', error);
    logger.warn({ err: error }, `Could not upload serve-sim metrics artifact for ${udid}.`);
  }
}
