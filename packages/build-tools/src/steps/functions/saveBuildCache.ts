import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  spawnAsync,
} from '@expo/steps';
import fs from 'fs';
import nullthrows from 'nullthrows';

import os from 'os';
import path from 'path';

import { compressCacheAsync, uploadCacheAsync } from './saveCache';
import { formatBytes } from '../../utils/artifacts';
import {
  CcacheBuildTarget,
  generateDefaultBuildCacheKeyAsync,
  getCcachePath,
} from '../../utils/cacheKey';
import {
  compressCocoapodsCacheAsync,
  compressCocoapodsDownloadCacheAsync,
  getCocoapodsCachePaths,
  getCocoapodsDownloadCachePath,
  resolveCocoapodsCacheKeyAsync,
  resolveCocoapodsDownloadCacheKeyAsync,
} from '../../utils/cocoapodsCache';
import { generateGradleCacheKeyAsync } from '../../utils/gradleCacheKey';

export function createSaveBuildCacheFunction(evictUsedBefore: Date): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'save_build_cache',
    name: 'Save Cache',
    __metricsId: 'eas/save_build_cache',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'platform',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'simulator',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
    ],
    fn: async (stepCtx, { env, inputs }) => {
      const { logger } = stepCtx;
      const workingDirectory = stepCtx.workingDirectory;
      const platform =
        (inputs.platform.value as Platform | undefined) ??
        stepCtx.global.staticContext.job.platform;
      if (!platform || ![Platform.ANDROID, Platform.IOS].includes(platform)) {
        throw new Error(
          `Unsupported platform: ${platform}. Platform must be "${Platform.ANDROID}" or "${Platform.IOS}"`
        );
      }

      const target: CcacheBuildTarget =
        platform === Platform.IOS
          ? {
              platform,
              simulator:
                (inputs.simulator.value as boolean | undefined) ??
                (stepCtx.global.staticContext.job.platform === Platform.IOS &&
                  stepCtx.global.staticContext.job.simulator === true),
            }
          : { platform };
      await saveCcacheAsync({
        logger,
        workingDirectory,
        target,
        evictUsedBefore,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });

      if (platform === Platform.ANDROID) {
        await saveGradleCacheAsync({
          logger,
          workingDirectory,
          env,
          secrets: stepCtx.global.staticContext.job.secrets,
        });
      } else {
        await saveCocoapodsDownloadCacheAsync({
          logger,
          workingDirectory,
          env,
          secrets: stepCtx.global.staticContext.job.secrets,
        });
        await saveCocoapodsCacheAsync({
          logger,
          workingDirectory,
          env,
          secrets: stepCtx.global.staticContext.job.secrets,
        });
      }
    },
  });
}

export async function saveCocoapodsDownloadCacheAsync({
  logger,
  workingDirectory,
  env,
  secrets,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  if (env.EAS_PODS_CACHE !== '1') {
    return;
  }

  const cocoapodsDownloadCachePath = getCocoapodsDownloadCachePath();
  try {
    await fs.promises.access(cocoapodsDownloadCachePath);
  } catch {
    logger.warn('No CocoaPods download cache found, skipping cache save');
    return;
  }

  try {
    const { stdout } = await spawnAsync('pod', ['--version'], {
      env,
      stdio: 'pipe',
    });
    const { key } = await resolveCocoapodsDownloadCacheKeyAsync(workingDirectory, stdout);
    logger.info(`Saving CocoaPods download cache key: ${key}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const robotAccessToken = nullthrows(
      secrets?.robotAccessToken,
      'Robot access token is required for cache operations'
    );
    const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');

    logger.info('Compressing CocoaPods download cache...');
    const { archivePath } = await compressCocoapodsDownloadCacheAsync();
    const { size } = await fs.promises.stat(archivePath);
    logger.info(`CocoaPods download cache archive size: ${formatBytes(size)}`);

    await uploadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      archivePath,
      key,
      paths: [cocoapodsDownloadCachePath],
      size,
      platform: Platform.IOS,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to save CocoaPods download cache');
  }
}

export async function saveCocoapodsCacheAsync({
  logger,
  workingDirectory,
  env,
  secrets,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  if (env.EAS_PODS_CACHE !== '1') {
    return;
  }

  const { podsDirectory, podfileLockPath } = getCocoapodsCachePaths(workingDirectory);
  try {
    await Promise.all([fs.promises.access(podsDirectory), fs.promises.access(podfileLockPath)]);
  } catch {
    logger.warn('No CocoaPods installation found, skipping cache save');
    return;
  }

  try {
    const { stdout } = await spawnAsync('pod', ['--version'], {
      env,
      stdio: 'pipe',
    });
    const { key } = await resolveCocoapodsCacheKeyAsync(workingDirectory, stdout);
    logger.info(`Saving CocoaPods cache key: ${key}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const robotAccessToken = nullthrows(
      secrets?.robotAccessToken,
      'Robot access token is required for cache operations'
    );
    const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');

    logger.info('Compressing CocoaPods cache...');
    const { archivePath } = await compressCocoapodsCacheAsync({ workingDirectory });
    const { size } = await fs.promises.stat(archivePath);
    logger.info(`CocoaPods cache archive size: ${formatBytes(size)}`);

    await uploadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      archivePath,
      key,
      paths: [podsDirectory],
      size,
      platform: Platform.IOS,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to save CocoaPods cache');
  }
}

export async function saveCcacheAsync({
  logger,
  workingDirectory,
  target,
  evictUsedBefore,
  env,
  secrets,
}: {
  logger: bunyan;
  workingDirectory: string;
  target: CcacheBuildTarget;
  evictUsedBefore: Date;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  const enabled =
    env.EAS_SAVE_CACHE === '1' || (env.EAS_USE_CACHE === '1' && env.EAS_SAVE_CACHE !== '0');

  if (!enabled) {
    return;
  }

  // Check if ccache is installed before proceeding
  const checkInstall = await asyncResult(
    spawnAsync('command', ['-v', 'ccache'], {
      env,
      stdio: 'pipe',
      shell: true,
    })
  );
  if (!checkInstall.ok) {
    return;
  }

  try {
    const cacheKey = await generateDefaultBuildCacheKeyAsync(workingDirectory, target);
    logger.info(`Saving cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const robotAccessToken = nullthrows(
      secrets?.robotAccessToken,
      'Robot access token is required for cache operations'
    );
    const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');
    const cachePath = getCcachePath(env);

    // Cache size can blow up over time over many builds, so evict stale files
    // and only upload what was used within this build's time window

    const evictWindow = Math.floor((Date.now() - evictUsedBefore.getTime()) / 1000);
    logger.info('Pruning cache...');
    await asyncResult(
      spawnAsync('ccache', ['--evict-older-than', evictWindow + 's'], {
        env,
        logger,
        stdio: 'pipe',
      })
    );

    logger.info('Preparing cache archive...');

    const { archivePath } = await compressCacheAsync({
      paths: [cachePath],
      workingDirectory,
      verbose: env.EXPO_DEBUG === '1',
      logger,
    });

    const { size } = await fs.promises.stat(archivePath);

    await uploadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      archivePath,
      key: cacheKey,
      paths: [cachePath],
      size,
      platform: target.platform,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to save cache');
  }
}

export async function saveGradleCacheAsync({
  logger,
  workingDirectory,
  env,
  secrets,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  if (env.EAS_GRADLE_CACHE !== '1') {
    return;
  }

  const gradleCachesPath = path.join(os.homedir(), '.gradle', 'caches');
  const buildCachePath = path.join(gradleCachesPath, 'build-cache-1');
  const journalPath = path.join(gradleCachesPath, 'journal-1');

  try {
    await fs.promises.access(buildCachePath);
  } catch {
    logger.warn('No Gradle build cache found, skipping save');
    return;
  }

  try {
    const cacheKey = await generateGradleCacheKeyAsync(workingDirectory);
    logger.info(`Saving Gradle cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const robotAccessToken = nullthrows(
      secrets?.robotAccessToken,
      'Robot access token is required for cache operations'
    );
    const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');

    await fs.promises.mkdir(journalPath, { recursive: true });

    logger.info('Compressing Gradle build cache...');
    const { archivePath } = await compressCacheAsync({
      paths: [buildCachePath, journalPath],
      workingDirectory: gradleCachesPath,
      verbose: env.EXPO_DEBUG === '1',
      logger,
    });

    const { size } = await fs.promises.stat(archivePath);
    logger.info(`Gradle cache archive size: ${formatBytes(size)}`);

    await uploadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      archivePath,
      key: cacheKey,
      paths: [buildCachePath, journalPath],
      size,
      platform: Platform.ANDROID,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to save Gradle cache');
  }
}
