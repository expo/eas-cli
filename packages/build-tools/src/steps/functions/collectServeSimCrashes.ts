import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import { rm } from 'node:fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { uploadServeSimCrashesFileAsync } from '../utils/serveSimCrashesArtifacts';
import { ServeSimCrashesRecorder } from '../utils/serveSimCrashesRecorder';

export function createCollectServeSimCrashesBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_serve_sim_crashes',
    name: 'Collect serve-sim simulator crashes',
    __metricsId: 'eas/collect_serve_sim_crashes',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      let outputDirectory: string | null = null;
      try {
        const collected = await ServeSimCrashesRecorder.finishAsync();
        outputDirectory = collected.outputDirectory;
        if (collected.crashes.length === 0) {
          logger.info('No simulator crashes collected; skipping upload.');
          return;
        }
        const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
        for (const { udid, filePath } of collected.crashes) {
          await uploadServeSimCrashesFileAsync(ctx, {
            deviceRunSessionId,
            udid,
            filePath,
            logger,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not finalize serve-sim simulator crashes', error);
        logger.warn(
          { err: error },
          'Could not finalize simulator crashes; the session result is unchanged.'
        );
      } finally {
        if (outputDirectory) {
          await rm(outputDirectory, { recursive: true, force: true }).catch(err => {
            logger.warn({ err }, 'Could not remove the simulator crash directory.');
          });
        }
      }
    },
  });
}
