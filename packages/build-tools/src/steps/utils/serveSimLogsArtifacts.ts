import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

export async function uploadServeSimLogsFileAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    udid,
    filePath,
    logger,
    signal,
  }: {
    deviceRunSessionId: string;
    udid: string;
    filePath: string;
    logger: bunyan;
    signal?: AbortSignal;
  }
): Promise<void> {
  try {
    const { size } = await stat(filePath);
    if (size === 0) {
      return;
    }
    const fileController = new AbortController();
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: `simulator-log-${udid}`,
      name: `App logs (${udid.slice(0, 8)})`,
      filename: 'app-logs.ndjson',
      kind: 'simulator-log',
      metadata: { __eas_type: 'simulator-log', udid, scope: 'user-apps', source: 'serve-sim/logs' },
      size,
      openStream: () => createReadStream(filePath).on('error', err => fileController.abort(err)),
      signal: AbortSignal.any([fileController.signal, ...(signal ? [signal] : [])]),
    });
  } catch (err) {
    logger.warn(
      { err },
      `Could not upload simulator logs for ${udid}; other artifacts will continue.`
    );
  }
}
