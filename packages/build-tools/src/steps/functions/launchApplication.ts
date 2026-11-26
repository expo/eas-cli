import {
  UserError,
  quoteAndroidShellCommand,
  validateAndroidLaunchOptions,
} from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn, { SpawnResult } from '@expo/turtle-spawn';

const IOS_URL_SCHEME_APPROVAL_DOMAIN = 'com.apple.launchservices.schemeapproval';
const IOS_URL_SCHEME_APPROVAL_KEY_PREFIX = 'com.apple.CoreSimulator.CoreSimulatorBridge-->';
// Match recognizable diagnostic/exception lines only so echoed `Starting: Intent { ... }` output
// containing exception-like action names or extra values cannot trigger misclassification.
const ANDROID_AM_START_INVALID_INPUT_LINE_PATTERN =
  /^(?:(?:[\w.$]*\.)?(?:IllegalArgumentException|NumberFormatException)(?::|$|\s)|(?:Error:\s*)?(?:Unknown option:|Invalid argument\b|Missing argument\b|Argument expected after\b|Can't start (?:activity|service) with user\b))/i;
const ANDROID_AM_START_UNRESOLVED_INTENT_LINE_PATTERN =
  /^(?:(?:Error:\s*|(?:[\w.$]+Exception:\s*))?(?:Activity not started,\s*)?(?:unable to resolve Intent|No Activity found to handle Intent)\b)/i;

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

  validateAndroidLaunchOptions({ launchArgs, openUrl });

  logApplicationLaunch(logger, applicationIdentifier, launchArgs);
  // Android does not support process arguments like iOS. Pass raw `am start` Intent
  // arguments instead, such as `--es key value` or `--ez key true`.
  try {
    await spawnAndroidShellCommandAsync(
      ['am', 'start', ...launchArgs, '-n', `${applicationIdentifier}/${activityName}`],
      { env, logger }
    );
  } catch (err) {
    if (err instanceof UserError) {
      throw err;
    }
    const output = getSpawnOutput(err);
    const detail = findMatchingOutputLine(output, ANDROID_AM_START_INVALID_INPUT_LINE_PATTERN);
    if (detail) {
      const subject = launchArgs.length > 0 ? '"launch_args"' : 'the launch arguments';
      throw new UserError(
        'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        `Launching ${applicationIdentifier} failed because Android "am start" rejected ${subject} (${detail}). Android expects "am start" Intent options (for example, ["--es", "key", "value"] or ["--ez", "isTest", "true"]), not iOS launch flags.`,
        { cause: err }
      );
    }
    throw err;
  }
  if (openUrl) {
    logger.info(`Opening ${openUrl} in ${applicationIdentifier}.`);
    let openUrlResult: SpawnResult;
    try {
      openUrlResult = await spawnAndroidShellCommandAsync(
        ['am', 'start', '-a', 'android.intent.action.VIEW', '-d', openUrl],
        { env, logger }
      );
    } catch (err) {
      if (err instanceof UserError) {
        throw err;
      }
      const output = getSpawnOutput(err);
      if (findMatchingOutputLine(output, ANDROID_AM_START_UNRESOLVED_INTENT_LINE_PATTERN)) {
        throw createUnregisteredUrlSchemeError(openUrl, err);
      }
      throw err;
    }
    // Older Android images (including API 30 and Android 14) print the unresolved-Intent error
    // for `am start` and still exit with status 0.
    if (
      findMatchingOutputLine(
        getSpawnOutput(openUrlResult),
        ANDROID_AM_START_UNRESOLVED_INTENT_LINE_PATTERN
      )
    ) {
      throw createUnregisteredUrlSchemeError(openUrl);
    }
  }
}

async function spawnAndroidShellCommandAsync(
  command: string[],
  { env, logger }: { env: BuildStepEnv; logger: bunyan }
): Promise<SpawnResult> {
  return await spawn('adb', ['shell', ...quoteAndroidShellCommand(command)], { env, logger });
}

function createUnregisteredUrlSchemeError(openUrl: string, cause?: unknown): UserError {
  const urlScheme = getUrlScheme(openUrl);
  const targetDescription = urlScheme
    ? `the "${urlScheme}://" URL from "open_url"`
    : 'the "open_url" VIEW intent';
  return new UserError(
    'EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME',
    `No installed activity on the Android Emulator matched the VIEW intent for ${targetDescription}. Ensure the app's AndroidManifest.xml registers an intent filter matching the URL's scheme, host, and path, or update "open_url".`,
    cause !== undefined ? { cause } : undefined
  );
}

function getSpawnOutput(source: unknown): string {
  if (typeof source !== 'object' || source === null) {
    return '';
  }
  const { stdout, stderr } = source as { stdout?: unknown; stderr?: unknown };
  return [stderr, stdout]
    .filter((stream): stream is string => typeof stream === 'string' && stream.length > 0)
    .join('\n');
}

function findMatchingOutputLine(output: string, pattern: RegExp): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .find(entry => pattern.test(entry));
  if (!line) {
    return undefined;
  }
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

function getUrlScheme(url: string): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  const scheme = new URL(url).protocol.slice(0, -1);
  return scheme.length > 0 ? scheme : undefined;
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
  const urlScheme = new URL(openUrl).protocol.slice(0, -1);
  if (urlScheme === 'http' || urlScheme === 'https') {
    return;
  }

  try {
    await spawn(
      'xcrun',
      [
        'simctl',
        'spawn',
        'booted',
        'defaults',
        'write',
        IOS_URL_SCHEME_APPROVAL_DOMAIN,
        `${IOS_URL_SCHEME_APPROVAL_KEY_PREFIX}${urlScheme}`,
        '-string',
        applicationIdentifier,
      ],
      { env, logger }
    );
  } catch (error) {
    logger.warn(
      { err: error },
      `Could not preapprove the ${urlScheme} URL scheme for ${applicationIdentifier}. Opening the URL anyway; the Simulator might require manual confirmation.`
    );
  }
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

export function parseNonEmptyStringInput(value: unknown, inputName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      `Input "${inputName}" must be a non-empty string. Pass the "${inputName}" output from eas/install_build.`
    );
  }
  return value;
}

export function parseLaunchArgsInput(value: unknown): string[] {
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

export function parseOpenUrlInput(value: unknown): string {
  const openUrl = parseNonEmptyStringInput(value, 'open_url');
  if (!URL.canParse(openUrl)) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      'Input "open_url" must be a valid URL.'
    );
  }
  return openUrl;
}
