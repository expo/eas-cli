import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import IosCredentialsManager from '../utils/ios/credentials/manager';
import { IosBuildCredentialsSchema } from '../utils/ios/credentials/credentials';

export function resolveAppleTeamIdFromCredentialsFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'resolve_apple_team_id_from_credentials',
    name: 'Resolve Apple team ID from credentials',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'credentials',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        defaultValue: '${ eas.job.secrets.buildCredentials }',
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'apple_team_id',
        required: true,
      }),
    ],
    fn: async (stepCtx, { inputs, outputs }) => {
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

      stepCtx.logger.info(`Using Apple Team ID: ${credentials.teamId}`);
      outputs.apple_team_id.set(credentials.teamId);
    },
  });
}
