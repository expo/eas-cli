import plist from '@expo/plist';
import { IOSConfig } from '@expo/config-plugins';
import { ManagedArtifactType, BuildMode, BuildPhase, Ios, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import { Artifacts, BuildContext } from '../context';
import {
  resolveRuntimeVersionForExpoUpdatesIfConfiguredAsync,
  configureExpoUpdatesIfInstalledAsync,
} from '../utils/expoUpdates';
import { uploadApplicationArchive } from '../utils/artifacts';
import { Hook, runHookIfPresent } from '../utils/hooks';
import { configureXcodeProject } from '../ios/configure';
import CredentialsManager from '../ios/credentials/manager';
import { runFastlaneGym, runFastlaneResign } from '../ios/fastlane';
import { installPods } from '../ios/pod';
import { downloadApplicationArchiveAsync } from '../ios/resign';
import { resolveArtifactPath, resolveBuildConfiguration, resolveScheme } from '../ios/resolve';
import { setupAsync } from '../common/setup';
import { prebuildAsync } from '../common/prebuild';
import { prepareExecutableAsync } from '../utils/prepareBuildExecutable';
import { getParentAndDescendantProcessPidsAsync } from '../utils/processes';
import { eagerBundleAsync, shouldUseEagerBundle } from '../common/eagerBundle';
import { saveCcacheAsync } from '../steps/functions/saveBuildCache';
import { cacheStatsAsync, restoreCcacheAsync } from '../steps/functions/restoreBuildCache';

import { runBuilderWithHooksAsync } from './common';
import { runCustomBuildAsync } from './custom';

const INSTALL_PODS_WARN_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const INSTALL_PODS_KILL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class InstallPodsTimeoutError extends Error {}

export default async function iosBuilder(ctx: BuildContext<Ios.Job>): Promise<Artifacts> {
  if (ctx.job.mode === BuildMode.BUILD) {
    await prepareExecutableAsync(ctx);
    return await runBuilderWithHooksAsync(ctx, buildAsync);
  } else if (ctx.job.mode === BuildMode.RESIGN) {
    return await resignAsync(ctx);
  } else if (ctx.job.mode === BuildMode.CUSTOM || ctx.job.mode === BuildMode.REPACK) {
    return await runCustomBuildAsync(ctx);
  } else {
    throw new Error('Not implemented');
  }
}

async function buildAsync(ctx: BuildContext<Ios.Job>): Promise<void> {
  await setupAsync(ctx);
  const hasNativeCode = ctx.job.type === Workflow.GENERIC;
  const evictUsedBefore = new Date();
  const credentialsManager = new CredentialsManager(ctx);
  const workingDirectory = ctx.getReactNativeProjectDirectory();
  try {
    const credentials = await ctx.runBuildPhase(BuildPhase.PREPARE_CREDENTIALS, async () => {
      return await credentialsManager.prepare();
    });

    await ctx.runBuildPhase(BuildPhase.PREBUILD, async () => {
      if (hasNativeCode) {
        ctx.markBuildPhaseSkipped();
        ctx.logger.info(
          'Skipped running "expo prebuild" because the "ios" directory already exists. Learn more about the build process: https://docs.expo.dev/build-reference/ios-builds/'
        );
        return;
      }
      const extraEnvs: Record<string, string> = credentials?.teamId
        ? { APPLE_TEAM_ID: credentials.teamId }
        : {};
      await prebuildAsync(ctx, {
        logger: ctx.logger,
        workingDir: ctx.getReactNativeProjectDirectory(),
        options: { extraEnvs },
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

    await ctx.runBuildPhase(BuildPhase.INSTALL_PODS, async () => {
      await runInstallPodsAsync(ctx);
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

    const buildConfiguration = resolveBuildConfiguration(ctx);
    if (credentials) {
      await ctx.runBuildPhase(BuildPhase.CONFIGURE_XCODE_PROJECT, async () => {
        await configureXcodeProject(ctx, { credentials, buildConfiguration });
      });
    }

    await ctx.runBuildPhase(BuildPhase.CONFIGURE_EXPO_UPDATES, async () => {
      await configureExpoUpdatesIfInstalledAsync(ctx, {
        resolvedRuntimeVersion: resolvedExpoUpdatesRuntimeVersion?.runtimeVersion ?? null,
        resolvedFingerprintSources: resolvedExpoUpdatesRuntimeVersion?.fingerprintSources ?? null,
      });
    });

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

    await ctx.runBuildPhase(BuildPhase.RUN_FASTLANE, async () => {
      const scheme = resolveScheme(ctx);
      const entitlements = await readEntitlementsAsync(ctx, { scheme, buildConfiguration });
      await runFastlaneGym(ctx, {
        credentials,
        scheme,
        buildConfiguration,
        entitlements,
        ...(resolvedExpoUpdatesRuntimeVersion?.runtimeVersion
          ? {
              extraEnv: {
                EXPO_UPDATES_FINGERPRINT_OVERRIDE:
                  resolvedExpoUpdatesRuntimeVersion?.runtimeVersion,
                EXPO_UPDATES_WORKFLOW_OVERRIDE: ctx.job.type,
              },
            }
          : null),
      });
    });
  } finally {
    await ctx.runBuildPhase(BuildPhase.CLEAN_UP_CREDENTIALS, async () => {
      await credentialsManager.cleanUp();
    });
  }

  await ctx.runBuildPhase(BuildPhase.PRE_UPLOAD_ARTIFACTS_HOOK, async () => {
    await runHookIfPresent(ctx, Hook.PRE_UPLOAD_ARTIFACTS);
  });

  await ctx.runBuildPhase(BuildPhase.UPLOAD_APPLICATION_ARCHIVE, async () => {
    await uploadApplicationArchive(ctx, {
      patternOrPath: resolveArtifactPath(ctx),
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
    });
  });
}

async function readEntitlementsAsync(
  ctx: BuildContext<Ios.Job>,
  { scheme, buildConfiguration }: { scheme: string; buildConfiguration: string }
): Promise<object | null> {
  try {
    const applicationTargetName =
      await IOSConfig.BuildScheme.getApplicationTargetNameForSchemeAsync(
        ctx.getReactNativeProjectDirectory(),
        scheme
      );
    const entitlementsPath = IOSConfig.Entitlements.getEntitlementsPath(
      ctx.getReactNativeProjectDirectory(),
      {
        buildConfiguration,
        targetName: applicationTargetName,
      }
    );
    if (!entitlementsPath) {
      return null;
    }
    const entitlementsRaw = await fs.readFile(entitlementsPath, 'utf8');
    return plist.parse(entitlementsRaw);
  } catch (err) {
    ctx.logger.warn({ err }, 'Failed to read entitlements');
    ctx.markBuildPhaseHasWarnings();
    return null;
  }
}

async function resignAsync(ctx: BuildContext<Ios.Job>): Promise<Artifacts> {
  const applicationArchivePath = await ctx.runBuildPhase(
    BuildPhase.DOWNLOAD_APPLICATION_ARCHIVE,
    async () => {
      return await downloadApplicationArchiveAsync(ctx);
    }
  );

  const credentialsManager = new CredentialsManager(ctx);
  try {
    const credentials = await ctx.runBuildPhase(BuildPhase.PREPARE_CREDENTIALS, async () => {
      return await credentialsManager.prepare();
    });

    await ctx.runBuildPhase(BuildPhase.RUN_FASTLANE, async () => {
      await runFastlaneResign(ctx, {
        credentials: nullthrows(credentials),
        ipaPath: applicationArchivePath,
      });
    });
  } finally {
    await ctx.runBuildPhase(BuildPhase.CLEAN_UP_CREDENTIALS, async () => {
      await credentialsManager.cleanUp();
    });
  }

  await ctx.runBuildPhase(BuildPhase.UPLOAD_APPLICATION_ARCHIVE, async () => {
    ctx.logger.info(`Application archive: ${applicationArchivePath}`);
    await ctx.uploadArtifact({
      artifact: {
        type: ManagedArtifactType.APPLICATION_ARCHIVE,
        paths: [applicationArchivePath],
      },
      logger: ctx.logger,
    });
  });

  return ctx.artifacts;
}

async function runInstallPodsAsync(ctx: BuildContext<Ios.Job>): Promise<void> {
  let warnTimeout: NodeJS.Timeout | undefined;
  let killTimeout: NodeJS.Timeout | undefined;
  let timedOutToKill: boolean = false;
  try {
    const installPodsSpawnPromise = (
      await installPods(ctx, {
        infoCallbackFn: () => {
          warnTimeout?.refresh();
          killTimeout?.refresh();
        },
      })
    ).spawnPromise;
    warnTimeout = setTimeout(() => {
      ctx.logger.warn(
        '"Install pods" phase takes longer then expected and it did not produce any logs in the past 15 minutes'
      );
    }, INSTALL_PODS_WARN_TIMEOUT_MS);

    killTimeout = setTimeout(async () => {
      timedOutToKill = true;
      ctx.logger.error(
        '"Install pods" phase takes a very long time and it did not produce any logs in the past 30 minutes. Most likely an unexpected error happened which caused the process to hang and it will be terminated'
      );
      const ppid = nullthrows(installPodsSpawnPromise.child.pid);
      const pids = await getParentAndDescendantProcessPidsAsync(ppid);
      pids.forEach((pid) => {
        process.kill(pid);
      });
      ctx.reportError?.('"Install pods" phase takes a very long time', undefined, {
        extras: { buildId: ctx.env.EAS_BUILD_ID },
      });
    }, INSTALL_PODS_KILL_TIMEOUT_MS);

    await installPodsSpawnPromise;
  } catch (err: any) {
    if (timedOutToKill) {
      throw new InstallPodsTimeoutError('"Install pods" phase was inactive for over 30 minutes');
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
