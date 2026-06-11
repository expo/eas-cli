import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { CustomBuildContext } from '../../customBuildContext';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
} from '../utils/remoteDeviceRunSession';

const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
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

      logger.info(`Selecting Xcode developer directory: ${XCODE_DEVELOPER_DIR}.`);
      await spawn('sudo', ['xcode-select', '-s', XCODE_DEVELOPER_DIR], { env, logger });

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

      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      // Keep the turtle job alive so the serve-sim tunnel stays reachable
      // until stopDeviceRunSession cancels the run.
      await new Promise<never>(() => {});
    },
  });
}
