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

import { sendCcacheStatsAsync } from './ccacheStats';
import { decompressCacheAsync, downloadCacheAsync, downloadPublicCacheAsync } from './restoreCache';
import {
  CACHE_KEY_PREFIX_BY_PLATFORM,
  generateDefaultBuildCacheKeyAsync,
  getCcachePath,
} from '../../utils/cacheKey';
import { GRADLE_CACHE_KEY_PREFIX, generateGradleCacheKeyAsync } from '../../utils/gradleCacheKey';
import { TurtleFetchError } from '../../utils/turtleFetch';

export function createRestoreBuildCacheFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'restore_build_cache',
    name: 'Restore Cache',
    __metricsId: 'eas/restore_build_cache',
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

      await restoreCcacheAsync({
        logger,
        workingDirectory,
        platform,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });

      if (platform === Platform.ANDROID) {
        await restoreGradleCacheAsync({
          logger,
          workingDirectory,
          env,
          secrets: stepCtx.global.staticContext.job.secrets,
        });
      }
    },
  });
}

export function createCacheStatsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'cache_stats',
    name: 'Cache Stats',
    __metricsId: 'eas/cache_stats',
    fn: async (stepCtx, { env }) => {
      const platform = stepCtx.global.staticContext.job.platform;
      if (!platform) {
        stepCtx.logger.warn('Platform not set, skipping cache stats');
        return;
      }
      await cacheStatsAsync({
        logger: stepCtx.logger,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });
    },
  });
}

export async function restoreCcacheAsync({
  logger,
  workingDirectory,
  platform,
  env,
  secrets,
}: {
  logger: bunyan;
  workingDirectory: string;
  platform: Platform;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  const enabled =
    env.EAS_RESTORE_CACHE === '1' || (env.EAS_USE_CACHE === '1' && env.EAS_RESTORE_CACHE !== '0');

  if (!enabled) {
    return;
  }
  const robotAccessToken = nullthrows(
    secrets?.robotAccessToken,
    'Robot access token is required for cache operations'
  );
  const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');
  const cachePath = getCcachePath(env);

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
    // Zero ccache stats for accurate tracking
    await asyncResult(
      spawnAsync('ccache', ['--zero-stats'], {
        env,
        stdio: 'pipe',
      })
    );

    const cacheKey = await generateDefaultBuildCacheKeyAsync(workingDirectory, platform);
    logger.info(`Restoring cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const { archivePath, matchedKey } = await downloadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      paths: [cachePath],
      key: cacheKey,
      keyPrefixes: [CACHE_KEY_PREFIX_BY_PLATFORM[platform]],
      platform,
    });

    await decompressCacheAsync({
      archivePath,
      workingDirectory,
      verbose: env.EXPO_DEBUG === '1',
      logger,
    });

    logger.info(
      `Cache restored successfully ${matchedKey === cacheKey ? '(direct hit)' : '(prefix match)'}`
    );
  } catch (err: unknown) {
    if (err instanceof TurtleFetchError && err.response?.status === 404) {
      logger.info('No cache found for this key');
    } else {
      logger.warn('Failed to restore cache: ', err);
    }
    if (env.EAS_USE_PUBLIC_CACHE === '1') {
      try {
        logger.info('Downloading public cache...');
        const { archivePath } = await downloadPublicCacheAsync({
          logger,
          expoApiServerURL,
          robotAccessToken,
          paths: [cachePath],
          platform,
        });
        await decompressCacheAsync({
          archivePath,
          workingDirectory,
          verbose: env.EXPO_DEBUG === '1',
          logger,
        });
      } catch (err: unknown) {
        logger.warn({ err }, 'Failed to download public cache');
      }
    }
  }
}

export async function restoreGradleCacheAsync({
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

  try {
    const gradlePropertiesPath = path.join(workingDirectory, 'android', 'gradle.properties');
    const gradlePropertiesContent = await fs.promises.readFile(gradlePropertiesPath, 'utf-8');
    await fs.promises.writeFile(
      gradlePropertiesPath,
      `${gradlePropertiesContent}\n\norg.gradle.caching=true\n`
    );

    // Configure cache cleanup via init script (works with both Gradle 8 and 9,
    // org.gradle.cache.cleanup property was removed in Gradle 9)
    const initScriptDir = path.join(os.homedir(), '.gradle', 'init.d');
    await fs.promises.mkdir(initScriptDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(initScriptDir, 'eas-cache-cleanup.gradle'),
      [
        'def cacheDir = new File(System.getProperty("user.home"), ".gradle/caches/build-cache-1")',
        'def countBefore = cacheDir.exists() ? cacheDir.listFiles()?.length ?: 0 : 0',
        'println "[EAS] Gradle build cache entries before cleanup: ${countBefore}"',
        '',
        'beforeSettings { settings ->',
        '    try {',
        '        settings.caches {',
        '            cleanup = Cleanup.ALWAYS',
        '            buildCache {',
        '                setRemoveUnusedEntriesAfterDays(3)',
        '            }',
        '        }',
        '        println "[EAS] Configured Gradle cache cleanup via init script"',
        '    } catch (Exception e) {',
        '        println "[EAS] Failed to configure cache cleanup: ${e.message}"',
        '    }',
        '}',
        '',
        'gradle.buildFinished {',
        '    def countAfter = cacheDir.exists() ? cacheDir.listFiles()?.length ?: 0 : 0',
        '    println "[EAS] Gradle build cache entries after build: ${countAfter} (was ${countBefore})"',
        '}',
        '',
      ].join('\n')
    );

    const robotAccessToken = nullthrows(
      secrets?.robotAccessToken,
      'Robot access token is required for cache operations'
    );
    const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');
    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const cacheKey = await generateGradleCacheKeyAsync(workingDirectory);
    logger.info(`Restoring Gradle cache key: ${cacheKey}`);

    const gradleCachesPath = path.join(os.homedir(), '.gradle', 'caches');

    const buildCachePath = path.join(gradleCachesPath, 'build-cache-1');

    const { archivePath, matchedKey } = await downloadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      paths: [buildCachePath],
      key: cacheKey,
      keyPrefixes: [GRADLE_CACHE_KEY_PREFIX],
      platform: Platform.ANDROID,
    });

    await fs.promises.mkdir(gradleCachesPath, { recursive: true });
    await decompressCacheAsync({
      archivePath,
      workingDirectory: gradleCachesPath,
      verbose: env.EXPO_DEBUG === '1',
      logger,
    });

    logger.info(
      `Gradle cache restored to ${gradleCachesPath} ${matchedKey === cacheKey ? '(direct hit)' : '(prefix match)'}`
    );
  } catch (err: unknown) {
    if (err instanceof TurtleFetchError && err.response?.status === 404) {
      logger.info('No Gradle cache found for this key');
    } else {
      logger.warn('Failed to restore Gradle cache: ', err);
    }
  }
}

export async function cacheStatsAsync({
  logger,
  env,
  secrets,
}: {
  logger: bunyan;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  const enabled =
    env.EAS_RESTORE_CACHE === '1' || (env.EAS_USE_CACHE === '1' && env.EAS_RESTORE_CACHE !== '0');

  if (!enabled) {
    return;
  }

  // Check if ccache is installed
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

  await asyncResult(
    spawnAsync('ccache', ['--show-stats', '-v'], {
      env,
      logger,
      stdio: 'pipe',
    })
  );

  const robotAccessToken = secrets?.robotAccessToken;
  const expoApiServerURL = env.__API_SERVER_URL;
  const buildId = env.EAS_BUILD_ID;

  if (robotAccessToken && expoApiServerURL && buildId) {
    await sendCcacheStatsAsync({
      env,
      expoApiServerURL,
      robotAccessToken,
      buildId,
    });
  }
}
