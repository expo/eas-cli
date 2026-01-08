import assert from 'assert';

import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { Ios } from '@expo/eas-build-job';
import semver from 'semver';

import { IosBuildCredentialsSchema } from '../utils/ios/credentials/credentials';
import IosCredentialsManager from '../utils/ios/credentials/manager';
import { updateVersionsAsync } from '../utils/ios/configure';
import { resolveBuildConfiguration } from '../utils/ios/resolve';

export function configureIosVersionFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'configure_ios_version',
    name: 'Configure iOS version',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'credentials',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        defaultValue: '${ eas.job.secrets.buildCredentials }',
      }),
      BuildStepInput.createProvider({
        id: 'build_configuration',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_number',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'app_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepCtx, { inputs }) => {
      const rawCredentialsInput = inputs.credentials.value as Record<string, any>;
      const { value, error } = IosBuildCredentialsSchema.validate(rawCredentialsInput, {
        stripUnknown: true,
        convert: true,
        abortEarly: false,
      });
      if (error) {
        throw error;
      }

      const credentialsManager = new IosCredentialsManager(value);
      const credentials = await credentialsManager.prepare(stepCtx.logger);

      assert(stepCtx.global.staticContext.job, 'Job is not defined');
      const job = stepCtx.global.staticContext.job as Ios.Job;

      const buildNumber =
        (inputs.build_number.value as string | undefined) ?? job.version?.buildNumber;
      const appVersion =
        (inputs.app_version.value as string | undefined) ?? job.version?.appVersion;
      if (appVersion && !semver.valid(appVersion)) {
        throw new Error(
          `App verrsion provided by the "app_version" input is not a valid semver version: ${appVersion}`
        );
      }

      if (!buildNumber && !appVersion) {
        stepCtx.logger.info(
          'No build number or app version provided. Skipping the step to configure iOS version.'
        );
        return;
      }

      stepCtx.logger.info('Setting iOS version...');
      if (buildNumber) {
        stepCtx.logger.info(`Build number: ${buildNumber}`);
      }
      if (appVersion) {
        stepCtx.logger.info(`App version: ${appVersion}`);
      }

      await updateVersionsAsync(
        stepCtx.logger,
        stepCtx.workingDirectory,
        {
          buildNumber,
          appVersion,
        },
        {
          targetNames: Object.keys(credentials.targetProvisioningProfiles),
          buildConfiguration: resolveBuildConfiguration(
            job,
            inputs.build_configuration.value as string | undefined
          ),
        }
      );
    },
  });
}
