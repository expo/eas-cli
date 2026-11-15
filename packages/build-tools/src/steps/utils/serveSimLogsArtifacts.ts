import { type bunyan } from '@expo/logger';

import { type CustomBuildContext } from '../../customBuildContext';
import { uploadDeviceRunSessionFileAsync } from './uploadDeviceRunSessionFile';

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
    await uploadDeviceRunSessionFileAsync(ctx, {
      filePath,
      describe: () => ({
        deviceRunSessionId,
        artifactId: `simulator-log-${udid}`,
        name: `App logs (${udid.slice(0, 8)})`,
        filename: 'app-logs.ndjson',
        kind: 'simulator-log',
        metadata: {
          __eas_type: 'simulator-log',
          udid,
          scope: 'user-apps',
          source: 'serve-sim/logs',
        },
      }),
      signal,
    });
  } catch (err) {
    logger.warn(
      { err },
      `Could not upload simulator logs for ${udid}; other artifacts will continue.`
    );
  }
}
