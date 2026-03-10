import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction } from '@expo/steps';
import fs from 'fs';
import nullthrows from 'nullthrows';
import path from 'path';

import { XCODE_CACHE_HIT_FLAG } from './restoreXcodeCache';
import { compressCacheAsync, uploadCacheAsync } from './saveCache';
import { generateXcodeCacheKeyAsync } from '../../utils/xcodeCacheKey';

export function createSaveXcodeCacheFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'save_xcode_cache',
    name: 'Save Xcode Cache',
    __metricsId: 'eas/save_xcode_cache',
    fn: async (stepCtx, { env }) => {
      const { logger } = stepCtx;
      const workingDirectory = stepCtx.workingDirectory;

      await saveXcodeCacheAsync({
        logger,
        workingDirectory,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });
    },
  });
}

export async function saveXcodeCacheAsync({
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
  if (env.XCODE_CACHE !== '1') {
    return;
  }

  // Don't save if cache was already hit (products came from cache)
  try {
    const flag = await fs.promises.readFile(XCODE_CACHE_HIT_FLAG, 'utf-8');
    if (flag.trim() === '1') {
      logger.info('Xcode cache was restored — skipping save');
      return;
    }
  } catch {
    // Flag file doesn't exist — cache miss, proceed with save
  }

  const productsPath = path.join('ios', 'build', 'Build', 'Products');
  const absoluteProductsPath = path.resolve(workingDirectory, productsPath);

  try {
    const stat = await fs.promises.stat(absoluteProductsPath);
    if (!stat.isDirectory()) {
      logger.warn('Products path is not a directory, skipping Xcode cache save');
      return;
    }
  } catch {
    logger.warn('No Products directory found, skipping Xcode cache save');
    return;
  }

  try {
    const cacheKey = await generateXcodeCacheKeyAsync(workingDirectory);
    logger.info(`Saving Xcode cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const robotAccessToken = nullthrows(
      secrets?.robotAccessToken,
      'Robot access token is required for cache operations'
    );
    const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');

    logger.info('Compressing Xcode build products...');

    const { archivePath } = await compressCacheAsync({
      paths: [productsPath],
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
      paths: [productsPath],
      size,
      platform: Platform.IOS,
    });

    logger.info('Xcode cache saved successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to save Xcode cache');
  }
}
