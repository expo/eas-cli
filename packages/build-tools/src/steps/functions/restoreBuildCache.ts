import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  spawnAsync,
} from '@expo/steps';
import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import nullthrows from 'nullthrows';

import {
  CACHE_KEY_PREFIX_BY_PLATFORM,
  generateDefaultBuildCacheKeyAsync,
  getCcachePath,
} from '../../utils/cacheKey';
import { TurtleFetchError } from '../../utils/turtleFetch';

import { downloadCacheAsync, decompressCacheAsync, downloadPublicCacheAsync } from './restoreCache';
import { sendCcacheStatsAsync } from './ccacheStats';

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
