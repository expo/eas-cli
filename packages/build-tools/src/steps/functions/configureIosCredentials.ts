import { Ios } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import assert from 'assert';

import { configureCredentialsAsync } from '../utils/ios/configure';
import { IosBuildCredentialsSchema } from '../utils/ios/credentials/credentials';
import IosCredentialsManager from '../utils/ios/credentials/manager';
import { resolveBuildConfiguration } from '../utils/ios/resolve';

export function configureIosCredentialsFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'configure_ios_credentials',
    name: 'Configure iOS credentials',
    __metricsId: 'eas/configure_ios_credentials',
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
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'target_names',
        required: true,
      }),
    ],
    fn: async (stepCtx, { inputs, outputs }) => {
      const { value, error } = IosBuildCredentialsSchema.validate(inputs.credentials.value, {
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
      outputs.target_names.set(JSON.stringify(Object.keys(credentials.targetProvisioningProfiles)));

      stepCtx.logger.info('Successfully configured iOS credentials');
    },
  });
}
