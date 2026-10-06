import { BuildJob, UserError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';

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
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'ignore_error',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
    ],
    fn: async (stepCtx, { env, inputs }) => {
      try {
        const appConfig = (
          await readAppConfig({
            projectDir: stepCtx.workingDirectory,
            env,
            logger: stepCtx.logger,
            sdkVersion: stepCtx.global.staticContext.metadata?.sdkVersion,
          })
        ).exp;
        const { status } = await uploadEmbeddedBundleAsync({
          job: ctx.job,
          env,
          logger: stepCtx.logger,
          projectDir: stepCtx.workingDirectory,
          appConfig,
        });
        if (status === 'skipped') {
          stepCtx.logger.info('Skipping embedded bundle upload.');
        } else if (status === 'failed') {
          throw new UserError(
            'EAS_UPLOAD_EMBEDDED_BUNDLE_FAILED',
            'Failed to upload embedded bundle. See the warning above for details.'
          );
        }
      } catch (err) {
        if (inputs.ignore_error.value) {
          stepCtx.logger.warn({ err }, 'Failed to upload embedded bundle. Ignoring error.');
          return;
        }
        throw err;
      }
    },
  });
}
