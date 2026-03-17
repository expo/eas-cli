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

const GRADLE_CACHES_DIR = '.gradle/caches';
const CACHE_SUBDIRS = ['build-cache-1'];

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
  if (env.EAS_GRADLE_CACHE !== '1') {
    return;
  }

  if (cacheHit) {
    logger.info('Gradle cache was restored — skipping save');
    return;
  }

  const gradleCachesPath = path.join(os.homedir(), GRADLE_CACHES_DIR);

  try {
    await fs.promises.access(gradleCachesPath);
  } catch {
    logger.warn('No Gradle caches directory found, skipping save');
    return;
  }

  const existingDirs = [];
  for (const subdir of CACHE_SUBDIRS) {
    try {
      await fs.promises.access(path.join(gradleCachesPath, subdir));
      existingDirs.push(subdir);
    } catch {
      // skip
    }
  }

  if (existingDirs.length === 0) {
    logger.warn('No cacheable Gradle directories found, skipping save');
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

    logger.info(`Compressing Gradle caches (${existingDirs.join(', ')})...`);
    const { archivePath } = await compressCacheAsync({
      paths: existingDirs,
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
      paths: ['gradle-caches'],
      size,
      platform: Platform.ANDROID,
    });

    logger.info('Gradle cache saved successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to save Gradle cache');
  }
}
