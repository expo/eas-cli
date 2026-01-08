import fs from 'fs';

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

import { generateDefaultBuildCacheKeyAsync, getCcachePath } from '../../utils/cacheKey';

import { compressCacheAsync, uploadCacheAsync } from './saveCache';

export function createSaveBuildCacheFunction(evictUsedBefore: Date): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'save_build_cache',
    name: 'Save Cache',
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

      await saveCcacheAsync({
        logger,
        workingDirectory,
        platform,
        evictUsedBefore,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });
    },
  });
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
