import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { type CustomBuildContext } from '../../customBuildContext';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { uploadServeSimMetricsFileAsync } from '../utils/serveSimMetricsArtifacts';
import { ServeSimMetricsRecorder } from '../utils/serveSimMetricsRecorder';

export function createCollectServeSimMetricsBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_serve_sim_metrics',
    name: 'Collect serve-sim metrics',
    __metricsId: 'eas/collect_serve_sim_metrics',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      const collected = await ServeSimMetricsRecorder.finishAsync({ logger });
      if (collected.length === 0) {
        logger.info('No serve-sim metrics collected; skipping upload.');
        return;
      }
      try {
        const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
        for (const { udid, filePath } of collected) {
          await uploadServeSimMetricsFileAsync(ctx, { deviceRunSessionId, udid, filePath, logger });
        }
      } catch (err) {
        logger.warn({ err }, 'Could not upload serve-sim metrics.');
      }
    },
  });
}
