import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { ServeSimMetricsRecorder } from '../utils/serveSimMetricsRecorder';

export function createStartServeSimMetricsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_metrics',
    name: 'Start serve-sim metrics',
    __metricsId: 'eas/start_serve_sim_metrics',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }) => {
      await ServeSimMetricsRecorder.startAsync({ logger });
    },
  });
}
