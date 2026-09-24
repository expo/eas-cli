import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { type CustomBuildContext } from '../../customBuildContext';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { uploadServeSimLogsFileAsync } from '../utils/serveSimLogsArtifacts';
import { ServeSimLogsRecorder } from '../utils/serveSimLogsRecorder';

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
        const signal = AbortSignal.timeout(30_000);
        for (const { udid, filePath } of collected) {
          await uploadServeSimLogsFileAsync(ctx, {
            deviceRunSessionId,
            udid,
            filePath,
            logger,
            signal,
          });
        }
      } catch (err) {
        logger.warn({ err }, 'Could not finalize simulator logs; the session result is unchanged.');
      }
    },
  });
}
