import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';
import { type CollectedCrash } from './serveSimCrashesRecorder';

export async function uploadServeSimCrashesFileAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    crash: { udid, filePath, size, number, processName },
    logger,
    signal,
  }: {
    deviceRunSessionId: string;
    crash: CollectedCrash;
    logger: bunyan;
    signal?: AbortSignal;
  }
): Promise<void> {
  const device = udid.slice(0, 8);
  try {
    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId,
      artifactId: `simulator-crash-${udid}-${number}`,
      name: processName
        ? `Crash report ${number}: ${processName} (${device})`
        : `Crash report ${number} (${device})`,
      // Process names are not paths; keep separators out of the download name.
      filename: `${(processName ?? 'crash').replace(/[/\\:\x00-\x1f]/g, '-')}-${number}.ips`,
      kind: 'simulator-crash',
      metadata: { __eas_type: 'simulator-crash', udid, source: 'serve-sim/crashes' },
      size,
      openStream: () => createReadStream(filePath),
      attempts: 3,
      signal,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not upload a simulator crash report', error, { level: 'warning' });
    logger.warn(
      { err: error },
      `Could not upload crash report ${number} for ${udid}; other artifacts will continue.`
    );
  }
}
