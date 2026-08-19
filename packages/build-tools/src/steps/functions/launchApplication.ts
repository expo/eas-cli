import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { z } from 'zod';

export function createLaunchApplicationFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'launch_application',
    name: 'Launch application',
    __metricsId: 'eas/launch_application',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'application_identifier',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'activity_name',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async ({ global, logger }, { inputs, env }) => {
      const applicationIdentifier = z.string().min(1).parse(inputs.application_identifier.value);
      const activityName = inputs.activity_name.value
        ? z.string().min(1).parse(inputs.activity_name.value)
        : undefined;
      await launchApplicationAsync({
        applicationIdentifier,
        activityName,
        runtimePlatform: global.runtimePlatform,
        env,
        logger,
      });
    },
  });
}

export async function launchApplicationAsync({
  applicationIdentifier,
  activityName,
  runtimePlatform,
  env,
  logger,
}: {
  applicationIdentifier: string;
  activityName?: string;
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    logger.info(`Launching ${applicationIdentifier}.`);
    await spawn('xcrun', ['simctl', 'launch', 'booted', applicationIdentifier], {
      env,
      logger,
    });
    return;
  }

  if (!activityName) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_MISSING_ACTIVITY',
      'Launching an Android application requires activity_name.'
    );
  }

  logger.info(`Launching ${applicationIdentifier}.`);
  await spawn('adb', ['shell', 'am', 'start', '-n', `${applicationIdentifier}/${activityName}`], {
    env,
    logger,
  });
}
