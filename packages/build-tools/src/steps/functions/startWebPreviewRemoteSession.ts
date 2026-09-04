import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  startDeviceWebPreviewWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

const STARTUP_TIMEOUT_MS = 200_000;

export function createStartWebPreviewRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_remote_session',
    name: 'Start web preview remote session',
    __metricsId: 'eas/start_serve_sim_remote_session',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'package_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'max_duration_seconds',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
    ],
    fn: async ({ logger, global }, { inputs, env, signal }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const maxDurationSeconds = inputs.max_duration_seconds?.value as number | undefined;
      const packageVersion = inputs.package_version?.value as string | undefined;
      const { runtimePlatform } = global;

      logger.info(`Starting web preview remote session (runtime: ${runtimePlatform}).`);

      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
      }

      const webPreview = await startDeviceWebPreviewWithTunnelAsync(ctx, {
        runtimePlatform,
        baseDomain: ngrokTunnelDomain,
        env,
        logger,
        timeoutMs: STARTUP_TIMEOUT_MS,
        packageVersion,
      });
      logger.info(`Preview URL: ${webPreview.previewUrl}`);

      try {
        await uploadRemoteSessionConfigAsync({
          ctx,
          deviceRunSessionId,
          remoteConfig: { previewUrl: webPreview.previewUrl },
          logger,
        });

        await waitForDeviceRunSessionStoppedAsync({
          ctx,
          deviceRunSessionId,
          logger,
          maxDurationSeconds,
          signal,
        });
      } finally {
        await webPreview.stopAsync();
      }
    },
  });
}
