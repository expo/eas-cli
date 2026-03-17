import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction } from '@expo/steps';
import fs from 'fs';
import nullthrows from 'nullthrows';
import os from 'os';
import path from 'path';

import { compressCacheAsync, uploadCacheAsync } from './saveCache';
import { formatBytes } from '../../utils/artifacts';
import { generateGradleCacheKeyAsync } from '../../utils/gradleCacheKey';

const GRADLE_BUILD_CACHE_DIR = '.gradle/caches/build-cache-1';

export function createSaveGradleCacheFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'save_gradle_cache',
    name: 'Save Gradle Cache',
    __metricsId: 'eas/save_gradle_cache',
    fn: async (stepCtx, { env }) => {
      const { logger } = stepCtx;
      const workingDirectory = stepCtx.workingDirectory;
      await saveGradleCacheAsync({
        logger,
        workingDirectory,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
        cacheHit: false,
      });
    },
  });
}

export async function saveGradleCacheAsync({
  logger,
  workingDirectory,
  env,
  secrets,
  cacheHit,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
  cacheHit: boolean;
}): Promise<void> {
  if (env.GRADLE_CACHE !== '1') {
    return;
  }

  if (cacheHit) {
    logger.info('Gradle cache was restored — skipping save');
    return;
  }

  const gradleCachesPath = path.join(os.homedir(), GRADLE_BUILD_CACHE_DIR);

  try {
    await fs.promises.access(gradleCachesPath);
  } catch {
    logger.warn('No Gradle caches directory found, skipping save');
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

    logger.info('Compressing Gradle caches...');
    const { archivePath } = await compressCacheAsync({
      paths: ['.'],
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
      paths: ['gradle-caches-v1'],
      size,
      platform: Platform.ANDROID,
    });

    logger.info('Gradle cache saved successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to save Gradle cache');
  }
}
