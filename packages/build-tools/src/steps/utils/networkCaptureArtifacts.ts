import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';

import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { formatBytes } from '../../utils/artifacts';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';
import { type RecordedNetworkCapture } from './serveSimNetworkCaptureRecorder';

const NETWORK_CAPTURE_ARTIFACT_FILENAME = 'network-capture.har';

/** Never rejects; a failed upload is logged. */
export async function uploadNetworkCaptureHarsAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    captures,
    logger,
  }: {
    deviceRunSessionId: string;
    captures: RecordedNetworkCapture[];
    logger: bunyan;
  }
): Promise<void> {
  const parts = new Map<string, number>();
  for (const capture of captures) {
    const part = (parts.get(capture.udid) ?? 0) + 1;
    parts.set(capture.udid, part);
    const label = part > 1 ? `, part ${part}` : '';
    try {
      logger.info(
        `Uploading the network capture for ${capture.udid}${label} (${formatBytes(capture.size)}).`
      );
      await uploadDeviceRunSessionArtifactAsync(ctx, {
        deviceRunSessionId,
        artifactId: `network-capture-${capture.udid}-${part}`,
        name: `Network capture (${capture.udid.slice(0, 8)}${label})`,
        filename: NETWORK_CAPTURE_ARTIFACT_FILENAME,
        kind: 'network-capture',
        metadata: { __eas_type: 'network-capture', format: 'har', udid: capture.udid, part },
        size: capture.size,
        stream: createReadStream(capture.filePath),
        reopenStream: () => createReadStream(capture.filePath),
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('Could not upload the network capture', error, { level: 'warning' });
      logger.warn({ err: error }, `Could not upload the network capture for ${capture.udid}.`);
    }
  }
}
