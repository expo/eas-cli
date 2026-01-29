import path from 'path';

import { Android, BuildMode, BuildPhase, Workflow } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import { Artifacts, BuildContext, SkipNativeBuildError } from '../context';
import {
  configureExpoUpdatesIfInstalledAsync,
  resolveRuntimeVersionForExpoUpdatesIfConfiguredAsync,
} from '../utils/expoUpdates';
import {
  runGradleCommand,
  ensureLFLineEndingsInGradlewScript,
  resolveGradleCommand,
} from '../android/gradle';
import { uploadApplicationArchive } from '../utils/artifacts';
import { Hook, runHookIfPresent } from '../utils/hooks';
import { restoreCredentials } from '../android/credentials';
import { configureBuildGradle } from '../android/gradleConfig';
import { setupAsync } from '../common/setup';
import { prebuildAsync } from '../common/prebuild';
import { prepareExecutableAsync } from '../utils/prepareBuildExecutable';
import { eagerBundleAsync, shouldUseEagerBundle } from '../common/eagerBundle';
import { cacheStatsAsync, restoreCcacheAsync } from '../steps/functions/restoreBuildCache';
import { saveCcacheAsync } from '../steps/functions/saveBuildCache';

import { runBuilderWithHooksAsync } from './common';
import { runCustomBuildAsync } from './custom';

export default async function androidBuilder(ctx: BuildContext<Android.Job>): Promise<Artifacts> {
  if (ctx.job.mode === BuildMode.BUILD) {
    await prepareExecutableAsync(ctx);
    return await runBuilderWithHooksAsync(ctx, buildAsync);
  } else if (ctx.job.mode === BuildMode.RESIGN) {
    throw new Error('Not implemented');
  } else if (ctx.job.mode === BuildMode.CUSTOM || ctx.job.mode === BuildMode.REPACK) {
    return await runCustomBuildAsync(ctx);
  } else {
    throw new Error('Not implemented');
  }
}

async function buildAsync(ctx: BuildContext<Android.Job>): Promise<void> {
  await setupAsync(ctx);
  const evictUsedBefore = new Date();
  const workingDirectory = ctx.getReactNativeProjectDirectory();
  const hasNativeCode = ctx.job.type === Workflow.GENERIC;

  if (hasNativeCode) {
    await ctx.runBuildPhase(BuildPhase.FIX_GRADLEW, async () => {
      await ensureLFLineEndingsInGradlewScript(ctx);
    });
  }

  await ctx.runBuildPhase(BuildPhase.PREBUILD, async () => {
    if (hasNativeCode) {
      ctx.markBuildPhaseSkipped();
      ctx.logger.info(
        'Skipped running "expo prebuild" because the "android" directory already exists. Learn more about the build process: https://docs.expo.dev/build-reference/android-builds/'
      );
      return;
    }
    await prebuildAsync(ctx, {
      logger: ctx.logger,
      workingDir: ctx.getReactNativeProjectDirectory(),
    });
  });

  await ctx.runBuildPhase(BuildPhase.RESTORE_CACHE, async () => {
    if (ctx.isLocal) {
      ctx.logger.info('Local builds do not support restoring cache');
      return;
    }
    await ctx.cacheManager?.restoreCache(ctx);
    await restoreCcacheAsync({
      logger: ctx.logger,
      workingDirectory,
      platform: ctx.job.platform,
      env: ctx.env,
      secrets: ctx.job.secrets,
    });
  });

  await ctx.runBuildPhase(BuildPhase.POST_INSTALL_HOOK, async () => {
    await runHookIfPresent(ctx, Hook.POST_INSTALL);
  });

  const resolvedExpoUpdatesRuntimeVersion = await ctx.runBuildPhase(
    BuildPhase.CALCULATE_EXPO_UPDATES_RUNTIME_VERSION,
    async () => {
      return await resolveRuntimeVersionForExpoUpdatesIfConfiguredAsync({
        cwd: ctx.getReactNativeProjectDirectory(),
        logger: ctx.logger,
        appConfig: ctx.appConfig,
        platform: ctx.job.platform,
        workflow: ctx.job.type,
        env: ctx.env,
      });
    }
  );

  if (
    nullthrows(ctx.job.secrets, 'Secrets must be defined for non-custom builds').buildCredentials
  ) {
    await ctx.runBuildPhase(BuildPhase.PREPARE_CREDENTIALS, async () => {
      await restoreCredentials(ctx);
      await configureBuildGradle(ctx);
    });
  }
  await ctx.runBuildPhase(BuildPhase.CONFIGURE_EXPO_UPDATES, async () => {
    await configureExpoUpdatesIfInstalledAsync(ctx, {
      resolvedRuntimeVersion: resolvedExpoUpdatesRuntimeVersion?.runtimeVersion ?? null,
      resolvedFingerprintSources: resolvedExpoUpdatesRuntimeVersion?.fingerprintSources ?? null,
    });
  });

  if (ctx.skipNativeBuild) {
    throw new SkipNativeBuildError('Skipping Gradle build');
  }

  if (!ctx.env.EAS_BUILD_DISABLE_BUNDLE_JAVASCRIPT_STEP && shouldUseEagerBundle(ctx.metadata)) {
    await ctx.runBuildPhase(BuildPhase.EAGER_BUNDLE, async () => {
      await eagerBundleAsync({
        platform: ctx.job.platform,
        workingDir: ctx.getReactNativeProjectDirectory(),
        logger: ctx.logger,
        env: {
          ...ctx.env,
          ...(resolvedExpoUpdatesRuntimeVersion?.runtimeVersion
            ? {
                EXPO_UPDATES_FINGERPRINT_OVERRIDE:
                  resolvedExpoUpdatesRuntimeVersion?.runtimeVersion,
                EXPO_UPDATES_WORKFLOW_OVERRIDE: ctx.job.type,
              }
            : null),
        },
        packageManager: ctx.packageManager,
      });
    });
  }

  await ctx.runBuildPhase(BuildPhase.RUN_GRADLEW, async () => {
    const gradleCommand = resolveGradleCommand(ctx.job);
    await runGradleCommand(ctx, {
      logger: ctx.logger,
      gradleCommand,
      androidDir: path.join(ctx.getReactNativeProjectDirectory(), 'android'),
      ...(resolvedExpoUpdatesRuntimeVersion?.runtimeVersion
        ? {
            extraEnv: {
              EXPO_UPDATES_FINGERPRINT_OVERRIDE: resolvedExpoUpdatesRuntimeVersion.runtimeVersion,
              EXPO_UPDATES_WORKFLOW_OVERRIDE: ctx.job.type,
            },
          }
        : null),
    });
  });

  await ctx.runBuildPhase(BuildPhase.PRE_UPLOAD_ARTIFACTS_HOOK, async () => {
    await runHookIfPresent(ctx, Hook.PRE_UPLOAD_ARTIFACTS);
  });

  await ctx.runBuildPhase(BuildPhase.UPLOAD_APPLICATION_ARCHIVE, async () => {
    await uploadApplicationArchive(ctx, {
      patternOrPath: ctx.job.applicationArchivePath ?? 'android/app/build/outputs/**/*.{apk,aab}',
      rootDir: ctx.getReactNativeProjectDirectory(),
      logger: ctx.logger,
    });
  });

  await ctx.runBuildPhase(BuildPhase.SAVE_CACHE, async () => {
    if (ctx.isLocal) {
      ctx.logger.info('Local builds do not support saving cache.');
      return;
    }
    await ctx.cacheManager?.saveCache(ctx);
    await saveCcacheAsync({
      logger: ctx.logger,
      workingDirectory,
      platform: ctx.job.platform,
      evictUsedBefore,
      env: ctx.env,
      secrets: ctx.job.secrets,
    });
  });

  await ctx.runBuildPhase(BuildPhase.CACHE_STATS, async () => {
    await cacheStatsAsync({
      logger: ctx.logger,
      env: ctx.env,
      secrets: ctx.job.secrets,
    });
  });
}
