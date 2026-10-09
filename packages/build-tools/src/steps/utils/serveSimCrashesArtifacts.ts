import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

export async function uploadServeSimCrashesFileAsync(
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
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: `simulator-crashes-${udid}`,
      name: `Crash reports (${udid.slice(0, 8)})`,
      filename: 'crashes.ndjson',
      kind: 'simulator-crashes',
      metadata: { __eas_type: 'simulator-crashes', udid, source: 'serve-sim/crashes' },
      size,
      stream: createReadStream(filePath),
      reopenStream: () => createReadStream(filePath),
      signal,
    });
  } catch (err) {
    logger.warn(
      { err },
      `Could not upload simulator crashes for ${udid}; other artifacts will continue.`
    );
  }
}
