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

const IOS_URL_SCHEME_APPROVAL_DOMAIN = 'com.apple.launchservices.schemeapproval';
const IOS_URL_SCHEME_APPROVAL_KEY_PREFIX = 'com.apple.CoreSimulator.CoreSimulatorBridge-->';

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
      BuildStepInput.createProvider({
        id: 'launch_args',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'open_url',
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
      const launchArgs = parseLaunchArgsInput(inputs.launch_args.value);
      const openUrl =
        inputs.open_url.value === undefined ? undefined : parseOpenUrlInput(inputs.open_url.value);
      await launchApplicationAsync({
        applicationIdentifier,
        activityName,
        launchArgs,
        openUrl,
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
  launchArgs = [],
  openUrl,
  runtimePlatform,
  env,
  logger,
}: {
  applicationIdentifier: string;
  activityName?: string;
  launchArgs?: string[];
  openUrl?: string;
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    logApplicationLaunch(logger, applicationIdentifier, launchArgs);
    await spawn('xcrun', ['simctl', 'launch', 'booted', applicationIdentifier, ...launchArgs], {
      env,
      logger,
    });
    if (openUrl) {
      await preapproveIosUrlSchemeAsync({ applicationIdentifier, openUrl, env, logger });
      logger.info(`Opening ${openUrl} in ${applicationIdentifier}.`);
      await spawn('xcrun', ['simctl', 'openurl', 'booted', openUrl], { env, logger });
    }
    return;
  }

  if (!activityName) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_MISSING_ACTIVITY',
      'Launching an Android application requires activity_name.'
    );
  }

  logApplicationLaunch(logger, applicationIdentifier, launchArgs);
  // Android does not support process arguments like iOS. Pass raw `am start` Intent
  // arguments instead, such as `--es key value` or `--ez key true`.
  await spawn(
    'adb',
    ['shell', 'am', 'start', ...launchArgs, '-n', `${applicationIdentifier}/${activityName}`],
    {
      env,
      logger,
    }
  );
  if (openUrl) {
    logger.info(`Opening ${openUrl} in ${applicationIdentifier}.`);
    await spawn(
      'adb',
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        openUrl,
        '-n',
        `${applicationIdentifier}/${activityName}`,
      ],
      { env, logger }
    );
  }
}

async function preapproveIosUrlSchemeAsync({
  applicationIdentifier,
  openUrl,
  env,
  logger,
}: {
  applicationIdentifier: string;
  openUrl: string;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  const urlScheme = new URL(openUrl).protocol;
  if (urlScheme === 'http:' || urlScheme === 'https:') {
    return;
  }

  await spawn(
    'xcrun',
    [
      'simctl',
      'spawn',
      'booted',
      'defaults',
      'write',
      IOS_URL_SCHEME_APPROVAL_DOMAIN,
      `${IOS_URL_SCHEME_APPROVAL_KEY_PREFIX}${urlScheme.slice(0, -1)}`,
      '-string',
      applicationIdentifier,
    ],
    { env, logger }
  );
}

function logApplicationLaunch(
  logger: bunyan,
  applicationIdentifier: string,
  launchArgs: string[]
): void {
  const argumentsDescription =
    launchArgs.length > 0 ? ` with arguments ${JSON.stringify(launchArgs)}` : '';
  logger.info(`Launching ${applicationIdentifier}${argumentsDescription}.`);
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

function parseLaunchArgsInput(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(argument => typeof argument === 'string')) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      'Input "launch_args" must be an array of strings.'
    );
  }
  return value;
}

function parseOpenUrlInput(value: unknown): string {
  const openUrl = parseNonEmptyStringInput(value, 'open_url');
  if (!URL.canParse(openUrl)) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      'Input "open_url" must be a valid URL.'
    );
  }
  return openUrl;
}
