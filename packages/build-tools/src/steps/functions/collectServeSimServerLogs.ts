import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { uploadServeSimServerLogsAsync } from '../utils/serveSimServerLogArtifacts';
import { takeServeSimServerLogs } from '../utils/serveSimServerLogs';

export function createCollectServeSimServerLogsBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_serve_sim_server_logs',
    name: 'Collect serve-sim server logs',
    __metricsId: 'eas/collect_serve_sim_server_logs',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      try {
        const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
        const logs = takeServeSimServerLogs(deviceRunSessionId);
        if (logs.length === 0) {
          logger.info('No serve-sim server logs collected; skipping upload.');
        }
        await uploadServeSimServerLogsAsync(ctx, { deviceRunSessionId, logs, logger });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not collect serve-sim server logs', error);
        logger.warn({ err: error }, 'Could not collect serve-sim server logs.');
      }
    },
  });
}
