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
import {
  XCODE_COMPILATION_CACHE_ENV,
  XCODE_COMPILATION_CACHE_RELATIVE_PATH,
  compressXcodeCompilationCacheAsync,
  generateXcodeCompilationCacheKeyAsync,
} from '../../ios/compilationCache';
import { formatBytes } from '../../utils/artifacts';
import { generateDefaultBuildCacheKeyAsync, getCcachePath } from '../../utils/cacheKey';
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

      await Promise.all([
        saveCcacheAsync({
          logger,
          workingDirectory,
          platform,
          evictUsedBefore,
          env,
          secrets: stepCtx.global.staticContext.job.secrets,
        }),
        platform === Platform.IOS
          ? saveXcodeCompilationCacheAsync({
              logger,
              workingDirectory,
              env,
              secrets: stepCtx.global.staticContext.job.secrets,
            })
          : saveGradleCacheAsync({
              logger,
              workingDirectory,
              env,
              secrets: stepCtx.global.staticContext.job.secrets,
            }),
      ]);
    },
  });
}

export async function saveXcodeCompilationCacheAsync({
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
  const buildCacheEnabled =
    env.EAS_SAVE_CACHE === '1' || (env.EAS_USE_CACHE === '1' && env.EAS_SAVE_CACHE !== '0');
  if (!buildCacheEnabled || env[XCODE_COMPILATION_CACHE_ENV] !== '1') {
    return;
  }

  try {
    const { key, xcodeVersion } = await generateXcodeCompilationCacheKeyAsync({
      workingDirectory,
      env,
      logger,
    });
    logger.info(`Saving Xcode compilation cache for ${xcodeVersion} with key: ${key}`);
    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const robotAccessToken = nullthrows(
      secrets?.robotAccessToken,
      'Robot access token is required for cache operations'
    );
    const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');
    const { archivePath } = await compressXcodeCompilationCacheAsync({
      workingDirectory,
      env,
      logger,
    });
    const { size } = await fs.promises.stat(archivePath);
    logger.info(`Xcode compilation cache archive size: ${formatBytes(size)}`);

    await uploadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      archivePath,
      key,
      paths: [XCODE_COMPILATION_CACHE_RELATIVE_PATH],
      size,
      platform: Platform.IOS,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to save Xcode compilation cache');
  }
}

export async function saveCcacheAsync({
  logger,
  workingDirectory,
  platform,
  evictUsedBefore,
  env,
  secrets,
}: {
  logger: bunyan;
  workingDirectory: string;
  platform: Platform;
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
    const cacheKey = await generateDefaultBuildCacheKeyAsync(workingDirectory, platform);
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
      platform,
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
