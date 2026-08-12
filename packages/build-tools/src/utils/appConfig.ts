import { ProjectConfig, getConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import { load } from '@expo/env';
import { LoggerLevel, bunyan } from '@expo/logger';
import semver from 'semver';

import { getEasBuildEnv, getExpoCommandEnv } from './environmentMode';
import { expoCommandAsync } from './expoCli';

interface ReadAppConfigParams {
  projectDir: string;
  env: Env;
  logger: bunyan;
  sdkVersion?: string;
}

export async function readAppConfig(params: ReadAppConfigParams): Promise<ProjectConfig> {
  let env = getEasBuildEnv(params.env);
  const shouldLoadEnvVarsFromDotenvFile =
    params.sdkVersion && semver.satisfies(params.sdkVersion, '>=49');
  if (shouldLoadEnvVarsFromDotenvFile) {
    env = loadEnvVarsFromDotenvFile(params.projectDir, env);
  }
  params = { ...params, env };

  // Reading the app config is done in two steps/attempts. We first attempt to run `expo config` as a CLI,
  try {
    return await getAppConfigFromExpo(params);
  } catch (error: any) {
    params.logger.warn(
      'Failed to read the app config file with `expo config` command:\n' +
        `${error?.message || error}`
    );
  }

  // If this fails, we fall back to directly using `@expo/config`
  // This can fail, since it's tied to a specific SDK version, so reading for older SDKs isn't guaranteed to work
  return getAppConfigFromExpoConfig(params);
}

async function getAppConfigFromExpo({
  projectDir,
  env,
}: ReadAppConfigParams): Promise<ProjectConfig> {
  const result = await expoCommandAsync(
    projectDir,
    ['config', '--json', '--full', '--type', 'public'],
    { env: getExpoCommandEnv(env) }
  );

  let parsed: any;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Failed to parse JSON output from 'expo config'.\nOutput: ${result.stdout.slice(0, 500)}`
    );
  }

  if (!('exp' in parsed)) {
    throw new Error(`Unexpected output from 'expo config': missing 'exp' field.`);
  }

  return parsed;
}

function loadEnvVarsFromDotenvFile(projectDir: string, env: Env): Env {
  const originalProcessEnv = process.env;
  try {
    // @expo/env 0.4 reads the mode from NODE_ENV.
    process.env = { ...env };
    load(projectDir);
    return getEasBuildEnv(process.env as Env);
  } finally {
    process.env = originalProcessEnv;
  }
}

function getAppConfigFromExpoConfig({
  projectDir,
  env,
  logger,
}: ReadAppConfigParams): ProjectConfig {
  const originalProcessExit = process.exit;
  const originalProcessCwd = process.cwd;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalProcessEnv = process.env;

  const stdoutStore: { text: string; level: LoggerLevel }[] = [];
  try {
    process.env = env;
    process.exit = () => {
      throw new Error('Failed to evaluate app config file');
    };
    process.cwd = () => projectDir;
    process.stdout.write = function (...args: any) {
      stdoutStore.push({ text: String(args[0]), level: LoggerLevel.INFO });
      return originalStdoutWrite.apply(process.stdout, args);
    };
    process.stderr.write = function (...args: any) {
      stdoutStore.push({ text: String(args[0]), level: LoggerLevel.ERROR });
      return originalStderrWrite.apply(process.stderr, args);
    };
    return getConfig(projectDir, {
      skipSDKVersionRequirement: true,
      isPublicConfig: true,
    });
  } catch (err) {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    stdoutStore.forEach(({ text, level }) => {
      logger[level](text.trim());
    });
    throw err;
  } finally {
    process.env = originalProcessEnv;
    process.exit = originalProcessExit;
    process.cwd = originalProcessCwd;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}
