import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
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
    fn: async ({ logger }, { env }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);

      logger.info('Starting serve-sim remote session.');

      await selectXcodeDeveloperDirectoryAsync({ env, logger });

      const { previewUrl } = await startServeSimWithTunnelAsync(ctx, {
        baseDomain: ngrokTunnelDomain,
        env,
        logger,
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
      logger.info(`Preview URL: ${previewUrl}`);

      await uploadRemoteSessionConfigAsync({
        ctx,
        deviceRunSessionId,
        remoteConfig: { previewUrl },
        logger,
      });

      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      // Keep the turtle job alive so the serve-sim tunnel stays reachable
      // until stopDeviceRunSession cancels the run.
      await new Promise<never>(() => {});
    },
  });
}
