import { BuildJob } from '@expo/eas-build-job';
import { BuildFunction } from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import { readAppConfig } from '../../utils/appConfig';
import { uploadEmbeddedBundleAsync } from '../../utils/expoUpdatesEmbedded';

export function createUploadEmbeddedBundleBuildFunction(
  ctx: CustomBuildContext<BuildJob>
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'upload_embedded_bundle',
    name: 'Upload embedded bundle',
    __metricsId: 'eas/upload_embedded_bundle',
    fn: async (stepCtx, { env }) => {
      try {
        const appConfig = (
          await readAppConfig({
            projectDir: stepCtx.workingDirectory,
            env,
            logger: stepCtx.logger,
            sdkVersion: stepCtx.global.staticContext.metadata?.sdkVersion,
          })
        ).exp;
        const result = await uploadEmbeddedBundleAsync({
          job: ctx.job,
          env,
          logger: stepCtx.logger,
          projectDir: stepCtx.workingDirectory,
          appConfig,
        });
        if (result === 'skipped') {
          stepCtx.logger.info('Skipping embedded bundle upload.');
        }
      } catch (err) {
        stepCtx.logger.warn({ err }, 'Failed to upload embedded bundle.');
      }
    },
  });
}
