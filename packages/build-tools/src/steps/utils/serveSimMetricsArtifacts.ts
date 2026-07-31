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
    metadata,
    logger,
  }: {
    deviceRunSessionId: string;
    udid: string;
    filePath: string;
    metadata?: Record<string, unknown>;
    logger: bunyan;
  }
): Promise<void> {
  let size: number;
  try {
    ({ size } = await stat(filePath));
  } catch {
    logger.info(`No serve-sim metrics file was written for ${udid}; skipping upload.`);
    return;
  }
  if (size === 0) {
    logger.info(`serve-sim metrics file for ${udid} is empty; skipping upload.`);
    return;
  }
  const deviceName = typeof metadata?.deviceName === 'string' ? metadata.deviceName : undefined;
  try {
    logger.info(`Uploading serve-sim metrics for ${deviceName ?? udid} (${formatBytes(size)}).`);
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: `metrics-${udid}`,
      name: `Performance metrics (${deviceName ?? udid.slice(0, 8)})`,
      filename: METRICS_ARTIFACT_FILENAME,
      kind: 'performance-metrics',
      metadata: {
        __eas_type: 'performance-metrics',
        udid,
        ...(deviceName && { deviceName }),
        ...(metadata && {
          hostCores: metadata.hostCores,
          sampleIntervalMs: metadata.sampleIntervalMs,
          schemaVersion: metadata.schemaVersion,
        }),
      },
      size,
      stream: createReadStream(filePath),
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not upload serve-sim metrics artifact', error);
    logger.warn({ err: error }, `Could not upload serve-sim metrics artifact for ${udid}.`);
  }
}
