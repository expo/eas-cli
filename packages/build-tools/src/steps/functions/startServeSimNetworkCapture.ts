import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';

import { Sentry } from '../../sentry';
import { ServeSimNetworkCaptureRecorder } from '../utils/serveSimNetworkCaptureRecorder';

export function createStartServeSimNetworkCaptureBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_network_capture',
    name: 'Start serve-sim network capture recording',
    __metricsId: 'eas/start_serve_sim_network_capture',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'package_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async ({ logger }, { inputs, env }) => {
      try {
        await ServeSimNetworkCaptureRecorder.startAsync({
          logger,
          env,
          packageVersion: inputs.package_version.value as string | undefined,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not start the serve-sim network capture recorder', error);
        logger.warn({ err: error }, 'Could not start the serve-sim network capture recorder.');
      }
    },
  });
}
