import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

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
      artifactId: `simulator-crashes-${udid}-${path.basename(filePath, '.ips')}`,
      name: `Crash report (${udid.slice(0, 8)})`,
      filename: path.basename(filePath),
      kind: 'simulator-crashes',
      metadata: { __eas_type: 'simulator-crashes', udid, source: 'serve-sim/crashes' },
      size,
      openStream: () => createReadStream(filePath),
      attempts: 3,
      signal,
    });
  } catch (err) {
    logger.warn(
      { err },
      `Could not upload simulator crashes for ${udid}; other artifacts will continue.`
    );
  }
}
