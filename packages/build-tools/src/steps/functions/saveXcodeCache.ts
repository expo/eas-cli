import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction } from '@expo/steps';
import fs from 'fs';
import nullthrows from 'nullthrows';
import os from 'os';
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
  logger.info(`[saveXcodeCacheAsync] entered, XCODE_CACHE=${env.XCODE_CACHE ?? 'unset'}`);

  if (env.XCODE_CACHE !== '1') {
    logger.info('[saveXcodeCacheAsync] XCODE_CACHE not set to 1, skipping');
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

  const productsDir = await findDerivedDataProductsAsync(logger);
  if (!productsDir) {
    logger.warn('No Products directory found, skipping Xcode cache save');
    return;
  }

  logger.info(`[saveXcodeCacheAsync] found Products at: ${productsDir}`);

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

    // Use the DerivedData project dir as the working directory for compression
    // so the archive contains paths relative to it
    const derivedDataProjectDir = path.resolve(productsDir, '..', '..');
    const relativePaths = [path.join('Build', 'Products')];

    const { archivePath } = await compressCacheAsync({
      paths: relativePaths,
      workingDirectory: derivedDataProjectDir,
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
      paths: relativePaths,
      size,
      platform: Platform.IOS,
    });

    logger.info('Xcode cache saved successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to save Xcode cache');
  }
}

/**
 * Find a DerivedData project directory that contains Build/Products.
 * Xcode stores DerivedData at ~/Library/Developer/Xcode/DerivedData/<ProjectName>-<hash>/
 */
async function findDerivedDataProductsAsync(logger: bunyan): Promise<string | null> {
  const derivedDataRoot = path.join(os.homedir(), 'Library', 'Developer', 'Xcode', 'DerivedData');

  try {
    const entries = await fs.promises.readdir(derivedDataRoot, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && e.name !== 'ModuleCache.noindex');

    for (const dir of dirs) {
      const productsPath = path.join(derivedDataRoot, dir.name, 'Build', 'Products');
      try {
        const stat = await fs.promises.stat(productsPath);
        if (stat.isDirectory()) {
          return productsPath;
        }
      } catch {
        // No Products in this DerivedData dir, try the next one
      }
    }

    logger.info(`[findDerivedDataProductsAsync] no Products found in ${derivedDataRoot}`);
    return null;
  } catch {
    logger.info(`[findDerivedDataProductsAsync] DerivedData root not found at ${derivedDataRoot}`);
    return null;
  }
}
