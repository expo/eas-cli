import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { ServeSimMetricsRecorder } from '../utils/serveSimMetricsRecorder';
import { startGuestMetricsAsync } from '../utils/guestMetricsRecorder';

export function createStartServeSimMetricsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_metrics',
    name: 'Start serve-sim metrics',
    __metricsId: 'eas/start_serve_sim_metrics',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      if (env.EAS_DEVICE_RUN_GUEST_METRICS === '1') {
        try {
          await startGuestMetricsAsync();
        } catch (err) {
          logger.warn({ err }, 'Could not start guest metrics.');
        }
      }
      await ServeSimMetricsRecorder.startAsync({ logger });
    },
  });
}
