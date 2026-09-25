import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { type CustomBuildContext } from '../../customBuildContext';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { uploadServeSimLogsFileAsync } from '../utils/serveSimLogsArtifacts';
import { ServeSimLogsRecorder } from '../utils/serveSimLogsRecorder';

const UPLOAD_TIMEOUT_MS = 30_000;

export function createCollectServeSimLogsBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_serve_sim_logs',
    name: 'Collect serve-sim simulator logs',
    __metricsId: 'eas/collect_serve_sim_logs',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      try {
        const collected = await ServeSimLogsRecorder.finishAsync({ logger });
        if (collected.length === 0) {
          logger.info('No simulator logs collected; skipping upload.');
          return;
        }
        const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
        for (const { udid, filePath } of collected) {
          // Each device gets its own budget so one stuck upload does not cancel the rest.
          await uploadServeSimLogsFileAsync(ctx, {
            deviceRunSessionId,
            udid,
            filePath,
            logger,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          });
        }
      } catch (err) {
        logger.warn({ err }, 'Could not finalize simulator logs; the session result is unchanged.');
      }
    },
  });
}
