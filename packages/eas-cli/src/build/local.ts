import { Env, Job, Metadata, version } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import { ChildProcess } from 'child_process';
import semver from 'semver';

import { getExpoApiBaseUrl } from '../api';
import Log from '../log';
import { ora } from '../ora';
import { getEnvWithoutInheritedDotenvValues } from '../utils/originalEnv';

const PLUGIN_PACKAGE_NAME = 'eas-cli-local-build-plugin';
const PLUGIN_PACKAGE_VERSION = version; // should match version of @expo/eas-build-job

// The plugin starts with an isolated env, so keep the runtime vars it needs from the user's
// machine.
const LOCAL_BUILD_RUNTIME_ENV_NAMES = [
  'ANDROID_HOME',
  'ANDROID_NDK_HOME',
  'ANDROID_SDK_ROOT',
  'HOME',
  'NVM_NODEJS_ORG_MIRROR',
  'PATH',
] as const;

export enum LocalBuildMode {
  /**
   * Local build that users can run on their own machines. Instead
   * of sending build request to EAS Servers it's passing it as an argument
   * to local-build-plugin, that will run the build locally.
   *
   * Triggered when running `eas build --local`.
   */
  LOCAL_BUILD_PLUGIN = 'local-build-plugin',
  /**
   * Type of local build that is not accessible to users directly. When
   * cloud build is triggered by git based integration, we are running
   * in this mode. Instead of sending build request to EAS Servers it's
   * printing it to the stdout as JSON, so EAS Build worker can read it.
   */
  INTERNAL = 'internal',
}

export interface LocalBuildOptions {
  localBuildMode?: LocalBuildMode;
  skipCleanup?: boolean;
  skipNativeBuild?: boolean;
  artifactsDir?: string;
  artifactPath?: string;
  workingdir?: string;
  verbose?: boolean;
}

export async function runLocalBuildAsync(
  job: Job,
  metadata: Metadata,
  options: LocalBuildOptions,
  env: Env
): Promise<void> {
  const { command, args } = await getCommandAndArgsAsync();
  // The job carries build credentials, so it is passed to the plugin via an
  // environment variable rather than a command-line argument. Otherwise it
  // would be exposed in the process list and, on failure, in the spawn error
  // message (which includes the command line) printed to stderr.
  const pluginInput = Buffer.from(JSON.stringify({ job, metadata })).toString('base64');
  let spinner;
  if (!options.verbose) {
    spinner = ora().start(options.skipNativeBuild ? 'Preparing project' : 'Building project');
  }
  let childProcess: ChildProcess | undefined;
  const interruptHandler = (): void => {
    if (childProcess) {
      childProcess.kill();
    }
  };
  process.on('SIGINT', interruptHandler);
  try {
    const processEnv = getEnvWithoutInheritedDotenvValues(process.env);
    const mergedEnv = {
      ...getLocalBuildRuntimeEnv(processEnv),
      ...env,
      EAS_LOCAL_BUILD_PLUGIN_INPUT: pluginInput,
      EAS_LOCAL_BUILD_WORKINGDIR: options.workingdir ?? processEnv.EAS_LOCAL_BUILD_WORKINGDIR,
      EAS_LOCAL_BUILD_LOGGER_LEVEL: processEnv.EAS_LOCAL_BUILD_LOGGER_LEVEL,
      __API_SERVER_URL: getExpoApiBaseUrl(),
      EAS_LOCAL_BUILD_SKIP_CLEANUP:
        options.skipCleanup || options.skipNativeBuild
          ? '1'
          : processEnv.EAS_LOCAL_BUILD_SKIP_CLEANUP,
      EAS_LOCAL_BUILD_SKIP_NATIVE_BUILD: options.skipNativeBuild
        ? '1'
        : processEnv.EAS_LOCAL_BUILD_SKIP_NATIVE_BUILD,
      EAS_LOCAL_BUILD_ARTIFACTS_DIR:
        options.artifactsDir ?? processEnv.EAS_LOCAL_BUILD_ARTIFACTS_DIR,
      EAS_LOCAL_BUILD_ARTIFACT_PATH:
        options.artifactPath ?? processEnv.EAS_LOCAL_BUILD_ARTIFACT_PATH,
    };
    // log command execution to assist in debugging local builds; redact the job
    // input since it contains build credentials.
    Log.debug('Running local build, using local-build-plugin', {
      command,
      args,
      env: { ...mergedEnv, EAS_LOCAL_BUILD_PLUGIN_INPUT: '[redacted]' },
    });
    const spawnPromise = spawnAsync(command, args, {
      stdio: options.verbose ? 'inherit' : 'pipe',
      env: mergedEnv,
    });
    childProcess = spawnPromise.child;
    await spawnPromise;
  } catch (error) {
    // The plugin's build output is already streamed to the terminal; add a
    // concise context summary to help debug the failure. Never dump the raw
    // job/metadata, which contains build credentials.
    spinner?.stop();
    logLocalBuildDebugInfo(job, metadata);
    throw error;
  } finally {
    process.removeListener('SIGINT', interruptHandler);
    spinner?.stop();
  }
}

function getLocalBuildRuntimeEnv(processEnv: NodeJS.ProcessEnv): Env {
  const env: Env = {};
  for (const name of LOCAL_BUILD_RUNTIME_ENV_NAMES) {
    const value = processEnv[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

/**
 * Logs an allowlisted, non-secret summary of the build's job/metadata to help
 * a user debug a failed local build. Only known-safe fields are included —
 * never the raw job/metadata (which carries credentials and other secrets).
 */
function logLocalBuildDebugInfo(job: Job, metadata: Metadata): void {
  // `platform` and `projectRootDirectory` live on the platform-specific job
  // variants; read them defensively since this is best-effort logging.
  const jobFields = job as { platform?: string; projectRootDirectory?: string };
  const trackingContext = metadata.trackingContext ?? {};

  const fields: [string, string | number | boolean | undefined][] = [
    ['Platform', jobFields.platform],
    ['Build profile', metadata.buildProfile],
    ['Workflow', metadata.workflow],
    ['Distribution', metadata.distribution],
    ['Credentials source', metadata.credentialsSource],
    ['Project root directory', jobFields.projectRootDirectory],
    ['Required package manager', metadata.requiredPackageManager],
    ['eas-cli version', metadata.cliVersion],
    ['SDK version', metadata.sdkVersion],
    ['Runtime version', metadata.runtimeVersion],
    ['React Native version', metadata.reactNativeVersion],
    ['Expo package version', metadata.expoPackageVersion],
    ['App version', metadata.appVersion],
    ['Fingerprint hash', metadata.fingerprintHash],
    ['Git commit', metadata.gitCommitHash],
    ['Git working tree dirty', metadata.isGitWorkingTreeDirty],
    ['Build tracking ID', trackingContext.tracking_id],
    ['Project ID', trackingContext.project_id],
  ];

  const lines = fields
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `  ${label}: ${String(value)}`);
  if (lines.length === 0) {
    return;
  }

  Log.newLine();
  Log.log(chalk.bold('Build context (for debugging this failed local build):'));
  Log.log(chalk.dim(lines.join('\n')));
}

async function getCommandAndArgsAsync(): Promise<{ command: string; args: string[] }> {
  // The job/metadata payload is passed to the plugin via the
  // EAS_LOCAL_BUILD_PLUGIN_INPUT environment variable, not as an argument.
  if (process.env.EAS_LOCAL_BUILD_PLUGIN_PATH) {
    return {
      command: process.env.EAS_LOCAL_BUILD_PLUGIN_PATH,
      args: [],
    };
  } else {
    const args = [`${PLUGIN_PACKAGE_NAME}@${PLUGIN_PACKAGE_VERSION}`];
    if (await isAtLeastNpm7Async()) {
      // npx shipped with npm >= 7.0.0 requires the "-y" flag to run commands without
      // prompting the user to install a package that is used for the first time
      args.unshift('-y');
    }
    return {
      command: 'npx',
      args,
    };
  }
}

async function isAtLeastNpm7Async(): Promise<boolean> {
  const version = (await spawnAsync('npm', ['--version'])).stdout.trim();
  return semver.gte(version, '7.0.0');
}
