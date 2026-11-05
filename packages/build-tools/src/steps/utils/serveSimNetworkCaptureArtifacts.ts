import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';

import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { formatBytes } from '../../utils/artifacts';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

const NETWORK_CAPTURE_ARTIFACT_FILENAME = 'network-capture.har';
const MAX_NETWORK_CAPTURE_ARTIFACT_SIZE_BYTES = 500 * 1024 * 1024;

/** Never rejects; a failed upload is logged. */
export async function uploadServeSimNetworkCaptureFileAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    udid,
    filePath,
    size,
    part,
    logger,
    signal,
  }: {
    deviceRunSessionId: string;
    udid: string;
    filePath: string;
    size: number;
    part: number;
    logger: bunyan;
    signal?: AbortSignal;
  }
): Promise<void> {
  const label = part > 1 ? `, part ${part}` : '';
  if (size > MAX_NETWORK_CAPTURE_ARTIFACT_SIZE_BYTES) {
    logger.warn(
      `Skipping network capture for ${udid}${label}: exceeds the ${formatBytes(MAX_NETWORK_CAPTURE_ARTIFACT_SIZE_BYTES)} upload limit.`
    );
    return;
  }
  try {
    logger.info(`Uploading the network capture for ${udid}${label} (${formatBytes(size)}).`);
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: `network-capture-${udid}-${part}`,
      name: `Network capture (${udid.slice(0, 8)}${label})`,
      filename: NETWORK_CAPTURE_ARTIFACT_FILENAME,
      kind: 'network-capture',
      metadata: { __eas_type: 'network-capture', format: 'har', udid, part },
      size,
      openStream: () => createReadStream(filePath),
      attempts: 3,
      signal,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not upload the network capture', error, { level: 'warning' });
    logger.warn({ err: error }, `Could not upload the network capture for ${udid}.`);
  }
}
