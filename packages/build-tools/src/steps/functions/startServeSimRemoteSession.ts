import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

const STARTUP_TIMEOUT_MS = 60_000;

export function createStartServeSimRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_remote_session',
    name: 'Start serve-sim remote session',
    __metricsId: 'eas/start_serve_sim_remote_session',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env, signal }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);

      logger.info('Starting serve-sim remote session.');

      await selectXcodeDeveloperDirectoryAsync({ env, logger });

      const { previewUrl, streamUrl } = await startServeSimWithTunnelAsync(ctx, {
        baseDomain: ngrokTunnelDomain,
        env,
        logger,
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
      logger.info(`Preview URL: ${previewUrl}`);
      logger.info(`Stream URL: ${streamUrl}`);

      await uploadRemoteSessionConfigAsync({
        ctx,
        deviceRunSessionId,
        remoteConfig: { previewUrl, streamUrl },
        logger,
      });

      await waitForDeviceRunSessionStoppedAsync({
        ctx,
        deviceRunSessionId,
        logger,
        signal,
      });
    },
  });
}
