import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import semver from 'semver';

import { eagerBundleAsync } from '../../common/eagerBundle';
import { resolvePackageManager } from '../../utils/packageManager';

export function eagerBundleBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'eager_bundle',
    name: 'Bundle JavaScript',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'resolved_eas_update_runtime_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepsCtx, { env, inputs }) => {
      const job = stepsCtx.global.staticContext.job;
      if (!job.platform) {
        throw new Error('Custom build job must have platform set');
      }
      if (
        stepsCtx.global.staticContext.metadata?.sdkVersion &&
        !semver.satisfies(stepsCtx.global.staticContext.metadata?.sdkVersion, '>=52')
      ) {
        throw new Error('Eager bundle is not supported for SDK version < 52');
      }

      const packageManager = resolvePackageManager(stepsCtx.workingDirectory);
      const resolvedEASUpdateRuntimeVersion = inputs.resolved_eas_update_runtime_version.value as
        | string
        | undefined;

      await eagerBundleAsync({
        platform: job.platform,
        workingDir: stepsCtx.workingDirectory,
        logger: stepsCtx.logger,
        env: {
          ...env,
          ...(resolvedEASUpdateRuntimeVersion
            ? {
                EXPO_UPDATES_FINGERPRINT_OVERRIDE: resolvedEASUpdateRuntimeVersion,
                EXPO_UPDATES_WORKFLOW_OVERRIDE: stepsCtx.global.staticContext.job.type,
              }
            : null),
        },
        packageManager,
      });
    },
  });
}
