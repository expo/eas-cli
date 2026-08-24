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
      const applicationIdentifier = parseNonEmptyStringInput(
        inputs.application_identifier.value,
        'application_identifier'
      );
      const activityName =
        inputs.activity_name.value === undefined
          ? undefined
          : parseNonEmptyStringInput(inputs.activity_name.value, 'activity_name');
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

function parseNonEmptyStringInput(value: unknown, inputName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      `Input "${inputName}" must be a non-empty string. Pass the "${inputName}" output from eas/install_build.`
    );
  }
  return value;
}
