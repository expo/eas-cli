import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { Sentry } from '../../sentry';
import { ServeSimCrashesRecorder } from '../utils/serveSimCrashesRecorder';

export function createStartServeSimCrashesBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_crashes',
    name: 'Start serve-sim simulator crashes',
    __metricsId: 'eas/start_serve_sim_crashes',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }) => {
      try {
        await ServeSimCrashesRecorder.startAsync({ logger });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not start serve-sim simulator crashes', error);
        logger.warn(
          { err: error },
          'Could not start simulator crash collection; the session will continue.'
        );
      }
    },
  });
}
