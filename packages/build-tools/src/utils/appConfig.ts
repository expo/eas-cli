import { ProjectConfig, getConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import { load } from '@expo/env';
import { LoggerLevel, bunyan } from '@expo/logger';
import spawnAsync from '@expo/turtle-spawn';
import isEqual from 'lodash/isEqual';
import path from 'path';
import semver from 'semver';

import { Datadog } from '../datadog';
import { expoCommandAsync } from './expoCli';

interface ReadAppConfigParams {
  projectDir: string;
  env: Env;
  logger: bunyan;
  sdkVersion?: string;
}

type AppConfigSource = 'expo-cli' | 'bundled-config';

interface AppConfigReadResult {
  appConfig: ProjectConfig;
  source: AppConfigSource;
}

interface AppConfigComparisonDetails {
  productionSource?: AppConfigSource;
  reason?: 'current_read_used_fallback' | 'production_read_failed';
}

const comparedBuildIds = new Set<string>();

export async function readAppConfig(params: ReadAppConfigParams): Promise<ProjectConfig> {
  const currentResult = await readAppConfigWithSource(params);

  if (markBuildForAppConfigComparison(params.env)) {
    await compareAppConfigWithProductionModeAsync(params, currentResult);
  }

  return currentResult.appConfig;
}

async function readAppConfigWithSource(params: ReadAppConfigParams): Promise<AppConfigReadResult> {
  const shouldLoadEnvVarsFromDotenvFile =
    params.sdkVersion && semver.satisfies(params.sdkVersion, '>=49');
  if (shouldLoadEnvVarsFromDotenvFile) {
    const envVarsFromDotenvFile = load(params.projectDir) as Env;
    const env = { ...params.env, ...envVarsFromDotenvFile };
    params = { ...params, env };
  }

  // Reading the app config is done in two steps/attempts. We first attempt to run `expo config` as a CLI,
  try {
    return {
      appConfig: await getAppConfigFromExpo(params),
      source: 'expo-cli',
    };
  } catch (error: any) {
    params.logger.warn(
      'Failed to read the app config file with `expo config` command:\n' +
        `${error?.message || error}`
    );
  }

  // If this fails, we fall back to directly using `@expo/config`
  // This can fail, since it's tied to a specific SDK version, so reading for older SDKs isn't guaranteed to work
  return {
    appConfig: getAppConfigFromExpoConfig(params),
    source: 'bundled-config',
  };
}

function markBuildForAppConfigComparison(env: Env): boolean {
  const buildId = env.EAS_BUILD_ID;
  if (env.EAS_BUILD_RUNNER !== 'eas-build' || !buildId || comparedBuildIds.has(buildId)) {
    return false;
  }
  comparedBuildIds.add(buildId);
  return true;
}

async function compareAppConfigWithProductionModeAsync(
  params: ReadAppConfigParams,
  currentResult: AppConfigReadResult
): Promise<void> {
  if (currentResult.source !== 'expo-cli') {
    logAppConfigComparison('error', currentResult.source, {
      reason: 'current_read_used_fallback',
    });
    return;
  }

  try {
    const productionAppConfig = await readAppConfigWithProductionModeAsync(params);
    const status = isEqual(currentResult.appConfig.exp, productionAppConfig.exp)
      ? 'match'
      : 'mismatch';
    logAppConfigComparison(status, currentResult.source, {
      productionSource: 'expo-cli',
    });
  } catch {
    logAppConfigComparison('error', currentResult.source, {
      reason: 'production_read_failed',
    });
  }
}

function logAppConfigComparison(
  status: 'match' | 'mismatch' | 'error',
  currentSource: AppConfigSource,
  { productionSource, reason }: AppConfigComparisonDetails = {}
): void {
  try {
    Datadog.log(`App config production mode comparison ${status}`, {
      event: 'app_config_production_mode_comparison',
      status,
      current_source: currentSource,
      ...(productionSource ? { production_source: productionSource } : {}),
      ...(reason ? { reason } : {}),
    });
  } catch {
    // Keep Datadog errors from failing the build.
  }
}

async function readAppConfigWithProductionModeAsync(
  params: ReadAppConfigParams
): Promise<ProjectConfig> {
  let env = getProductionAppConfigEnv(params.env);
  const shouldLoadEnvVarsFromDotenvFile =
    params.sdkVersion && semver.satisfies(params.sdkVersion, '>=49');
  if (shouldLoadEnvVarsFromDotenvFile) {
    const dotenvEnv = await readProductionDotenvEnvAsync(params.projectDir, env);
    env = { ...dotenvEnv, ...env };
  }

  return getAppConfigFromExpo({ ...params, env });
}

async function readProductionDotenvEnvAsync(projectDir: string, env: Env): Promise<Env> {
  const result = await spawnAsync(
    process.execPath,
    [path.join(__dirname, 'appConfigEnvWorker.js'), projectDir],
    {
      cwd: projectDir,
      env,
      stdio: 'pipe',
    }
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('Failed to parse the production dotenv worker output.');
  }

  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== 'object' ||
    Object.values(parsed).some(value => typeof value !== 'string')
  ) {
    throw new Error('The production dotenv worker returned invalid env vars.');
  }

  return parsed as Env;
}

function getProductionAppConfigEnv(env: Env): Env {
  return {
    ...env,
    NODE_ENV: 'production',
    __EXPO_CONFIG_MODE: 'production',
  };
}

async function getAppConfigFromExpo({
  projectDir,
  env,
}: ReadAppConfigParams): Promise<ProjectConfig> {
  const result = await expoCommandAsync(
    projectDir,
    ['config', '--json', '--full', '--type', 'public'],
    { env }
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
