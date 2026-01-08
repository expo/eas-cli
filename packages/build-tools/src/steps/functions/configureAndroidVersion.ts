import assert from 'assert';

import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import semver from 'semver';
import { Android } from '@expo/eas-build-job';

import { injectConfigureVersionGradleConfig } from '../utils/android/gradleConfig';

export function configureAndroidVersionFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'configure_android_version',
    name: 'Configure Android version',
    __metricsId: 'eas/configure_android_version',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'version_name',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'version_code',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepCtx, { inputs }) => {
      assert(stepCtx.global.staticContext.job, 'Job is not defined');
      const job = stepCtx.global.staticContext.job as Android.Job;

      const versionCode =
        (inputs.version_code.value as string | undefined) ?? job.version?.versionCode;
      const versionName =
        (inputs.version_name.value as string | undefined) ?? job.version?.versionName;
      if (versionName && !semver.valid(versionName)) {
        throw new Error(
          `Version name provided by the "version_name" input is not a valid semver version: ${versionName}`
        );
      }
      await injectConfigureVersionGradleConfig(stepCtx.logger, stepCtx.workingDirectory, {
        versionCode,
        versionName,
      });
    },
  });
}
