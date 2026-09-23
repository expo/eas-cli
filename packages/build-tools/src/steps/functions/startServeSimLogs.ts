import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { ServeSimLogsRecorder } from '../utils/serveSimLogsRecorder';

export function createStartServeSimLogsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_logs',
    name: 'Start serve-sim simulator logs',
    __metricsId: 'eas/start_serve_sim_logs',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }) => {
      try {
        await ServeSimLogsRecorder.startAsync({ logger });
      } catch (err) {
        logger.warn(
          { err },
          'Could not start simulator log collection; the session will continue.'
        );
      }
    },
  });
}
