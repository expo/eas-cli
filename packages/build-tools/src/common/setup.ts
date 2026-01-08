import path from 'path';

import spawn, { SpawnResult } from '@expo/turtle-spawn';
import fs from 'fs-extra';
import { BuildJob, BuildPhase, Ios, Job, Platform } from '@expo/eas-build-job';
import { BuildTrigger } from '@expo/eas-build-job/dist/common';
import nullthrows from 'nullthrows';
import { ExpoConfig } from '@expo/config';
import { UserFacingError } from '@expo/eas-build-job/dist/errors';

import { BuildContext } from '../context';
import { deleteXcodeEnvLocalIfExistsAsync } from '../ios/xcodeEnv';
import { Hook, runHookIfPresent } from '../utils/hooks';
import { setUpNpmrcAsync } from '../utils/npmrc';
import {
  shouldUseFrozenLockfile,
  isAtLeastNpm7Async,
  getPackageVersionFromPackageJson,
} from '../utils/packageManager';
import { readEasJsonContents, readPackageJson } from '../utils/project';
import { getParentAndDescendantProcessPidsAsync } from '../utils/processes';
import { retryAsync } from '../utils/retry';

import { prepareProjectSourcesAsync } from './projectSources';
import { installDependenciesAsync, resolvePackagerDir } from './installDependencies';
import { resolveEnvFromBuildProfileAsync, runEasBuildInternalAsync } from './easBuildInternal';

const MAX_EXPO_DOCTOR_TIMEOUT_MS = 30 * 1000;
const INSTALL_DEPENDENCIES_WARN_TIMEOUT_MS = 15 * 60 * 1000;
const INSTALL_DEPENDENCIES_KILL_TIMEOUT_MS = 30 * 60 * 1000;

class DoctorTimeoutError extends Error {}
class InstallDependenciesTimeoutError extends Error {}

export async function setupAsync<TJob extends BuildJob>(ctx: BuildContext<TJob>): Promise<void> {
  await ctx.runBuildPhase(BuildPhase.PREPARE_PROJECT, async () => {
    await retryAsync(
      async () => {
        await fs.rm(ctx.buildDirectory, { recursive: true, force: true });
        await fs.mkdir(ctx.buildDirectory, { recursive: true });

        await prepareProjectSourcesAsync(ctx, ctx.buildDirectory);
      },
      {
        retryOptions: {
          retries: 3,
          retryIntervalMs: 1_000,
        },
      }
    );

    await setUpNpmrcAsync(ctx, ctx.logger);
    if (ctx.job.platform === Platform.IOS && ctx.env.EAS_BUILD_RUNNER === 'eas-build') {
      await deleteXcodeEnvLocalIfExistsAsync(ctx as BuildContext<Ios.Job>);
    }
    if (ctx.job.triggeredBy === BuildTrigger.GIT_BASED_INTEGRATION) {
      // We need to setup envs from eas.json before
      // eas-build-pre-install hook is called.
      const env = await resolveEnvFromBuildProfileAsync(ctx, {
        cwd: ctx.getReactNativeProjectDirectory(),
      });
      ctx.updateEnv(env);
    }
  });

  await ctx.runBuildPhase(BuildPhase.PRE_INSTALL_HOOK, async () => {
    await runHookIfPresent(ctx, Hook.PRE_INSTALL);
  });

  await ctx.runBuildPhase(BuildPhase.READ_EAS_JSON, async () => {
    try {
      const easJsonContents = readEasJsonContents(ctx.getReactNativeProjectDirectory());
      ctx.logger.info('Using eas.json:');
      ctx.logger.info(easJsonContents);
    } catch (err) {
      ctx.logger.error({ err }, `Failed to read eas.json.`);
    }
  });

  const packageJson = await ctx.runBuildPhase(BuildPhase.READ_PACKAGE_JSON, async () => {
    ctx.logger.info('Using package.json:');
    const packageJson = readPackageJson(ctx.getReactNativeProjectDirectory());
    ctx.logger.info(JSON.stringify(packageJson, null, 2));
    return packageJson;
  });

  await ctx.runBuildPhase(BuildPhase.INSTALL_DEPENDENCIES, async () => {
    const expoVersion =
      ctx.metadata?.sdkVersion ??
      getPackageVersionFromPackageJson({
        packageJson,
        packageName: 'expo',
      });

    const reactNativeVersion =
      ctx.metadata?.reactNativeVersion ??
      getPackageVersionFromPackageJson({
        packageJson,
        packageName: 'react-native',
      });

    await runInstallDependenciesAsync(ctx, {
      useFrozenLockfile: shouldUseFrozenLockfile({
        env: ctx.env,
        sdkVersion: expoVersion,
        reactNativeVersion,
      }),
    });
  });

  await ctx.runBuildPhase(BuildPhase.READ_APP_CONFIG, async () => {
    const appConfig = ctx.appConfig;
    ctx.logger.info('Using app configuration:');
    ctx.logger.info(JSON.stringify(appConfig, null, 2));
    await validateAppConfigAsync(ctx, appConfig);
  });

  if (ctx.job.triggeredBy === BuildTrigger.GIT_BASED_INTEGRATION) {
    await ctx.runBuildPhase(BuildPhase.EAS_BUILD_INTERNAL, async () => {
      if (!ctx.appConfig.ios?.bundleIdentifier && ctx.job.platform === Platform.IOS) {
        throw new Error(
          'The "ios.bundleIdentifier" is required to be set in app config for builds triggered by GitHub integration. Learn more: https://docs.expo.dev/versions/latest/config/app/#bundleidentifier.'
        );
      }
      if (!ctx.appConfig.android?.package && ctx.job.platform === Platform.ANDROID) {
        throw new Error(
          'The "android.package" is required to be set in app config for builds triggered by GitHub integration. Learn more: https://docs.expo.dev/versions/latest/config/app/#package.'
        );
      }
      const { newJob, newMetadata } = await runEasBuildInternalAsync({
        job: ctx.job,
        env: ctx.env,
        logger: ctx.logger,
        cwd: ctx.getReactNativeProjectDirectory(),
        projectRootOverride: ctx.env.EAS_NO_VCS ? ctx.buildDirectory : undefined,
      });
      ctx.updateJobInformation(newJob, newMetadata);
    });
  }

  const hasExpoPackage = !!packageJson.dependencies?.expo;
  if (!ctx.env.EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP && hasExpoPackage) {
    await ctx.runBuildPhase(BuildPhase.RUN_EXPO_DOCTOR, async () => {
      try {
        await runExpoDoctor(ctx);
      } catch (err) {
        if (err instanceof DoctorTimeoutError) {
          ctx.logger.error(err.message);
        } else {
          ctx.logger.error({ err }, 'Command "expo doctor" failed.');
        }
        ctx.markBuildPhaseHasWarnings();
      }
    });
  }
}

async function runExpoDoctor<TJob extends Job>(ctx: BuildContext<TJob>): Promise<SpawnResult> {
  ctx.logger.info('Running "expo doctor"');
  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  const isAtLeastNpm7 = await isAtLeastNpm7Async();
  try {
    const argsPrefix = isAtLeastNpm7 ? ['-y'] : [];
    const promise = spawn('npx', [...argsPrefix, 'expo-doctor'], {
      cwd: ctx.getReactNativeProjectDirectory(),
      logger: ctx.logger,
      env: ctx.env,
    });
    timeout = setTimeout(async () => {
      timedOut = true;
      const ppid = nullthrows(promise.child.pid);
      const pids = await getParentAndDescendantProcessPidsAsync(ppid);
      pids.forEach((pid) => {
        process.kill(pid);
      });
      ctx.reportError?.(`"expo doctor" timed out`, undefined, {
        extras: { buildId: ctx.env.EAS_BUILD_ID },
      });
    }, MAX_EXPO_DOCTOR_TIMEOUT_MS);
    return await promise;
  } catch (err: any) {
    if (timedOut) {
      throw new DoctorTimeoutError('"expo doctor" timed out, skipping...');
    }
    throw err;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function runInstallDependenciesAsync<TJob extends Job>(
  ctx: BuildContext<TJob>,
  {
    useFrozenLockfile,
  }: {
    useFrozenLockfile: boolean;
  }
): Promise<void> {
  let warnTimeout: NodeJS.Timeout | undefined;
  let killTimeout: NodeJS.Timeout | undefined;
  let killTimedOut: boolean = false;
  try {
    const installDependenciesSpawnPromise = (
      await installDependenciesAsync({
        packageManager: ctx.packageManager,
        env: ctx.env,
        logger: ctx.logger,
        infoCallbackFn: () => {
          if (warnTimeout) {
            warnTimeout.refresh();
          }
          if (killTimeout) {
            killTimeout.refresh();
          }
        },
        cwd: resolvePackagerDir(ctx),
        useFrozenLockfile,
      })
    ).spawnPromise;

    warnTimeout = setTimeout(() => {
      ctx.logger.warn(
        '"Install dependencies" phase takes longer then expected and it did not produce any logs in the past 15 minutes. Consider evaluating your package.json file for possible issues with dependencies'
      );
    }, INSTALL_DEPENDENCIES_WARN_TIMEOUT_MS);

    killTimeout = setTimeout(async () => {
      killTimedOut = true;
      ctx.logger.error(
        '"Install dependencies" phase takes a very long time and it did not produce any logs in the past 30 minutes. Most likely an unexpected error happened with your dependencies which caused the process to hang and it will be terminated'
      );
      const ppid = nullthrows(installDependenciesSpawnPromise.child.pid);
      const pids = await getParentAndDescendantProcessPidsAsync(ppid);
      pids.forEach((pid) => {
        process.kill(pid);
      });
      ctx.reportError?.('"Install dependencies" phase takes a very long time', undefined, {
        extras: { buildId: ctx.env.EAS_BUILD_ID },
      });
    }, INSTALL_DEPENDENCIES_KILL_TIMEOUT_MS);

    await installDependenciesSpawnPromise;
  } catch (err: any) {
    if (killTimedOut) {
      throw new InstallDependenciesTimeoutError(
        '"Install dependencies" phase was inactive for over 30 minutes. Please evaluate your package.json file'
      );
    }
    throw err;
  } finally {
    if (warnTimeout) {
      clearTimeout(warnTimeout);
    }
    if (killTimeout) {
      clearTimeout(killTimeout);
    }
  }
}

async function validateAppConfigAsync(
  ctx: BuildContext<Job>,
  appConfig: ExpoConfig
): Promise<void> {
  if (
    appConfig?.extra?.eas?.projectId &&
    ctx.env.EAS_BUILD_PROJECT_ID &&
    appConfig.extra.eas.projectId !== ctx.env.EAS_BUILD_PROJECT_ID
  ) {
    const isUsingDynamicConfig =
      (await fs.pathExists(path.join(ctx.getReactNativeProjectDirectory(), 'app.config.ts'))) ||
      (await fs.pathExists(path.join(ctx.getReactNativeProjectDirectory(), 'app.config.js')));
    const isGitHubBuild = ctx.job.triggeredBy === BuildTrigger.GIT_BASED_INTEGRATION;
    let extraMessage = '';
    if (isGitHubBuild && isUsingDynamicConfig) {
      extraMessage =
        'Make sure you connected your GitHub repository to the correct Expo project and if you are using environment variables to switch between projects in app.config.js/app.config.ts remember to set those variables in eas.json too. ';
    } else if (isGitHubBuild) {
      extraMessage = 'Make sure you connected your GitHub repository to the correct Expo project. ';
    } else if (isUsingDynamicConfig) {
      extraMessage =
        'If you are using environment variables to switch between projects in app.config.js/app.config.ts, make sure those variables are also set inside EAS Build. You can do that using "env" field in eas.json or EAS environment variables. ';
    }
    throw new UserFacingError(
      'EAS_BUILD_PROJECT_ID_MISMATCH',
      `The value of the "extra.eas.projectId" field (${appConfig.extra.eas.projectId}) in the app config does not match the current project id (${ctx.env.EAS_BUILD_PROJECT_ID}). ${extraMessage}Learn more: https://expo.fyi/eas-config-mismatch.`
    );
  } else if (ctx.env.EAS_BUILD_PROJECT_ID && !appConfig?.extra?.eas?.projectId) {
    ctx.logger.error(`The "extra.eas.projectId" field is missing from your app config.`);
    ctx.markBuildPhaseHasWarnings();
  }
}
