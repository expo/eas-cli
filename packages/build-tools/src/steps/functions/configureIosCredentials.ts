import assert from 'assert';

import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { Ios } from '@expo/eas-build-job';

import IosCredentialsManager from '../utils/ios/credentials/manager';
import { IosBuildCredentialsSchema } from '../utils/ios/credentials/credentials';
import { configureCredentialsAsync } from '../utils/ios/configure';
import { resolveBuildConfiguration } from '../utils/ios/resolve';

export function configureIosCredentialsFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'configure_ios_credentials',
    name: 'Configure iOS credentials',
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

      await configureCredentialsAsync(stepCtx.logger, stepCtx.workingDirectory, {
        credentials,
        buildConfiguration: resolveBuildConfiguration(
          job,
          inputs.build_configuration.value as string | undefined
        ),
      });

      stepCtx.logger.info('Successfully configured iOS credentials');
    },
  });
}
