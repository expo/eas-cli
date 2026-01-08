import path from 'path';

import { v4 as uuidv4 } from 'uuid';
import {
  BuildFunction,
  BuildStepContext,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import fs from 'fs-extra';
import Joi from 'joi';
import { Android } from '@expo/eas-build-job';

import { injectCredentialsGradleConfig } from '../utils/android/gradleConfig';

const KeystoreSchema = Joi.object({
  dataBase64: Joi.string().required(),
  keystorePassword: Joi.string().allow('').required(),
  keyAlias: Joi.string().required(),
  keyPassword: Joi.string().allow(''),
});

const AndroidBuildCredentialsSchema = Joi.object<{ keystore: Android.Keystore }>({
  keystore: KeystoreSchema.required(),
}).required();

export function injectAndroidCredentialsFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'inject_android_credentials',
    name: 'Inject Android credentials',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'credentials',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        defaultValue: '${ eas.job.secrets.buildCredentials }',
      }),
    ],
    fn: async (stepCtx, { inputs }) => {
      const rawCredentialsInput = inputs.credentials.value as Record<string, any>;
      const { value, error } = AndroidBuildCredentialsSchema.validate(rawCredentialsInput, {
        stripUnknown: true,
        convert: true,
        abortEarly: false,
      });
      if (error) {
        throw error;
      }
      const credentials = value;

      await restoreCredentials(stepCtx, credentials);
      await injectCredentialsGradleConfig(stepCtx.logger, stepCtx.workingDirectory);
    },
  });
}

async function restoreCredentials(
  stepsCtx: BuildStepContext,
  buildCredentials: {
    keystore: Android.Keystore;
  }
): Promise<void> {
  stepsCtx.logger.info("Writing secrets to the project's directory");
  const keystorePath = path.join(stepsCtx.global.projectTargetDirectory, `keystore-${uuidv4()}`);
  await fs.writeFile(keystorePath, Buffer.from(buildCredentials.keystore.dataBase64, 'base64'));
  const credentialsJson = {
    android: {
      keystore: {
        keystorePath,
        keystorePassword: buildCredentials.keystore.keystorePassword,
        keyAlias: buildCredentials.keystore.keyAlias,
        keyPassword: buildCredentials.keystore.keyPassword,
      },
    },
  };
  await fs.writeFile(
    path.join(stepsCtx.global.projectTargetDirectory, 'credentials.json'),
    JSON.stringify(credentialsJson)
  );
}
