import { Env, Ios } from '@expo/eas-build-job';
import spawn, { SpawnOptions, SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import fs from 'fs-extra';
import path from 'path';
import semver from 'semver';

import { BuildContext } from '../context';

const MIN_PRECOMPILED_MODULES_EXPO_VERSION = '55.0.21';
// const PRECOMPILED_MODULES_BASE_URL = 'https://storage.googleapis.com/eas-build-precompiled-modules/';

export async function installPods<TJob extends Ios.Job>(
  ctx: BuildContext<TJob>,
  { infoCallbackFn }: SpawnOptions
): Promise<{ spawnPromise: SpawnPromise<SpawnResult> }> {
  const iosDir = path.join(ctx.getReactNativeProjectDirectory(), 'ios');

  const verboseFlag = ctx.env['EAS_VERBOSE'] === '1' ? ['--verbose'] : [];
  const cocoapodsDeploymentFlag = ctx.env['POD_INSTALL_DEPLOYMENT'] === '1' ? ['--deployment'] : [];
  const precompiledModulesEnv = await resolvePrecompiledModulesPodInstallEnvAsync(ctx);

  return {
    spawnPromise: spawn('pod', ['install', ...verboseFlag, ...cocoapodsDeploymentFlag], {
      cwd: iosDir,
      logger: ctx.logger,
      env: {
        ...ctx.env,
        LANG: 'en_US.UTF-8',
        ...precompiledModulesEnv,
      },
      lineTransformer: (line?: string) => {
        if (
          !line ||
          /\[!\] '[\w-]+' uses the unencrypted 'http' protocol to transfer the Pod\./.exec(line)
        ) {
          return null;
        } else {
          return line;
        }
      },
      infoCallbackFn,
    }),
  };
}

async function resolvePrecompiledModulesPodInstallEnvAsync<TJob extends Ios.Job>(
  ctx: BuildContext<TJob>
): Promise<Env> {
  if (ctx.job.builderEnvironment?.env?.EAS_USE_PRECOMPILED_MODULES !== '1') {
    return {};
  }

  let expoPackageVersion: string;
  try {
    expoPackageVersion = await getInstalledExpoPackageVersionAsync(ctx);
  } catch (err) {
    ctx.logger.info(
      { err },
      'Failed to detect installed Expo package version; not enabling precompiled modules use.'
    );
    return {};
  }

  const validExpoPackageVersion = semver.valid(expoPackageVersion);
  if (!validExpoPackageVersion) {
    ctx.logger.info(
      `Detected expo=${expoPackageVersion}; not enabling precompiled modules use because the installed Expo package version is not a valid semver version.`
    );
    return {};
  }

  if (semver.lt(validExpoPackageVersion, MIN_PRECOMPILED_MODULES_EXPO_VERSION)) {
    ctx.logger.info(
      `Detected expo=${validExpoPackageVersion}; not enabling precompiled modules use because precompiled modules require expo>=${MIN_PRECOMPILED_MODULES_EXPO_VERSION}.`
    );
    return {};
  }

  // Start rollout with Expo precompiled modules only. Add third-party modules after this is stable.
  const env: Env = {
    EXPO_USE_PRECOMPILED_MODULES: '1',
    // EXPO_PRECOMPILED_MODULES_BASE_URL: getPrecompiledModulesBaseUrl(),
  };

  ctx.logger.info(
    `Detected expo=${validExpoPackageVersion}; enabling precompiled modules use. Installing pods with additional environment variables.\n${Object.entries(
      env
    )
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\nPrecompiled modules pod install environment is configured.`
  );

  return env;
}

async function getInstalledExpoPackageVersionAsync<TJob extends Ios.Job>(
  ctx: BuildContext<TJob>
): Promise<string> {
  const { stdout } = await spawn('node', ['--print', "require.resolve('expo/package.json')"], {
    cwd: ctx.getReactNativeProjectDirectory(),
    env: ctx.env,
    stdio: 'pipe',
  });
  const expoPackageJsonPath = stdout.toString().trim();
  return (await fs.readJson(expoPackageJsonPath)).version;
}

// function getPrecompiledModulesBaseUrl<TJob extends Ios.Job>(ctx: BuildContext<TJob>): string {
//   if (!ctx.env.EAS_BUILD_COCOAPODS_CACHE_URL) {
//     return PRECOMPILED_MODULES_BASE_URL;
//   }
//
//   const parsedUrl = new URL(PRECOMPILED_MODULES_BASE_URL);
//   return PRECOMPILED_MODULES_BASE_URL.replace(
//     `${parsedUrl.protocol}//${parsedUrl.host}`,
//     `${ctx.env.EAS_BUILD_COCOAPODS_CACHE_URL.replace(/\/$/, '')}/${parsedUrl.host}`
//   );
// }
