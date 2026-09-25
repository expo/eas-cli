import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { Sentry } from '../../sentry';
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
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not start serve-sim simulator logs', error);
        logger.warn(
          { err: error },
          'Could not start simulator log collection; the session will continue.'
        );
      }
    },
  });
}
