import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import { rm } from 'node:fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { uploadServeSimNetworkCaptureFileAsync } from '../utils/serveSimNetworkCaptureArtifacts';
import { ServeSimNetworkCaptureRecorder } from '../utils/serveSimNetworkCaptureRecorder';

// Each HAR may be up to 500 MiB, so one slow upload gets its own long limit.
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

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
        const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
        // A device's HARs are numbered parts, one per capture har run that recorded requests.
        const parts = new Map<string, number>();
        for (const { udid, filePath, size } of captures) {
          const part = (parts.get(udid) ?? 0) + 1;
          parts.set(udid, part);
          await uploadServeSimNetworkCaptureFileAsync(ctx, {
            deviceRunSessionId,
            udid,
            filePath,
            size,
            part,
            logger,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          });
        }
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
