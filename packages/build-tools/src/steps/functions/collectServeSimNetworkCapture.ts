import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import { rm } from 'node:fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { uploadNetworkCaptureHarsAsync } from '../utils/networkCaptureArtifacts';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { ServeSimNetworkCaptureRecorder } from '../utils/serveSimNetworkCaptureRecorder';

export function createCollectServeSimNetworkCaptureBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_serve_sim_network_capture',
    name: 'Collect serve-sim network capture',
    __metricsId: 'eas/collect_serve_sim_network_capture',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      const { outputDirectory, captures } = await ServeSimNetworkCaptureRecorder.finishAsync({
        logger,
      });
      try {
        if (captures.length === 0) {
          logger.info('No network capture was recorded; skipping upload.');
          return;
        }
        await uploadNetworkCaptureHarsAsync(ctx, {
          deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
          captures,
          logger,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not upload the network capture', error);
        logger.warn({ err: error }, 'Could not upload the network capture.');
      } finally {
        if (outputDirectory) {
          await rm(outputDirectory, { recursive: true, force: true }).catch(err => {
            logger.warn(
              { err },
              `Could not remove the network capture directory ${outputDirectory}.`
            );
          });
        }
      }
    },
  });
}
