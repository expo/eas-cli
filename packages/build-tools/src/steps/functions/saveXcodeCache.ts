import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction } from '@expo/steps';
import fs from 'fs';
import nullthrows from 'nullthrows';
import path from 'path';

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
        cacheHit: false,
      });
    },
  });
}

export async function saveXcodeCacheAsync({
  logger,
  workingDirectory,
  env,
  secrets,
  cacheHit,
  simulator,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
  cacheHit: boolean;
  simulator?: boolean;
}): Promise<void> {
  logger.info(`[saveXcodeCacheAsync] entered, XCODE_CACHE=${env.XCODE_CACHE ?? 'unset'}, cacheHit=${cacheHit}`);

  if (env.XCODE_CACHE !== '1') {
    logger.info('[saveXcodeCacheAsync] XCODE_CACHE not set to 1, skipping');
    return;
  }

  if (cacheHit) {
    logger.info('Xcode cache was restored — skipping save');
    return;
  }

  const productsPath = await findBuildProductsPathAsync(workingDirectory, logger);
  if (!productsPath) {
    logger.warn('No build products found, skipping Xcode cache save');
    return;
  }

  logger.info(`[saveXcodeCacheAsync] found products at: ${productsPath}`);

  // Cache the contents of the products directory directly (flat).
  // The archive will contain files like EXAV/libEXAV.a, EXAV/EXAV.modulemap, etc.
  // On restore, we extract to a stable path outside DerivedData.
  const cachePaths = ['pods-products-v2'];
  const compressPaths = ['.'];

  try {
    const cacheKey = await generateXcodeCacheKeyAsync(workingDirectory, simulator);
    logger.info(`Saving Xcode cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const robotAccessToken = nullthrows(
      secrets?.robotAccessToken,
      'Robot access token is required for cache operations'
    );
    const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');

    logger.info('Compressing Xcode build products...');

    const { archivePath } = await compressCacheAsync({
      paths: compressPaths,
      workingDirectory: productsPath,
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
      paths: cachePaths,
      size,
      platform: Platform.IOS,
    });

    logger.info('Xcode cache saved successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to save Xcode cache');
  }
}

/**
 * Find the build products directory. Checks both archive and simulator paths.
 */
async function findBuildProductsPathAsync(workingDirectory: string, logger: bunyan): Promise<string | null> {
  const iosBuildDir = path.join(workingDirectory, 'ios', 'build');

  // Archive build: Build/Intermediates.noindex/ArchiveIntermediates/<AppName>/BuildProductsPath/Release-iphoneos/
  const archiveIntermediatesDir = path.join(iosBuildDir, 'Build', 'Intermediates.noindex', 'ArchiveIntermediates');
  try {
    const entries = await fs.promises.readdir(archiveIntermediatesDir);
    for (const entry of entries) {
      const buildProductsPath = path.join(archiveIntermediatesDir, entry, 'BuildProductsPath');
      try {
        const configs = await fs.promises.readdir(buildProductsPath);
        const releaseDir = configs.find((c) => c.startsWith('Release-'));
        if (releaseDir) {
          const fullPath = path.join(buildProductsPath, releaseDir);
          logger.info(`[findBuildProductsPathAsync] found archive products: ${fullPath}`);
          return fullPath;
        }
      } catch {
        // No BuildProductsPath in this entry
      }
    }
  } catch {
    // No ArchiveIntermediates directory
  }

  // Simulator build: Build/Products/Release-iphonesimulator/
  const productsDir = path.join(iosBuildDir, 'Build', 'Products');
  try {
    const configs = await fs.promises.readdir(productsDir);
    const releaseDir = configs.find((c) => c.startsWith('Release-'));
    if (releaseDir) {
      const fullPath = path.join(productsDir, releaseDir);
      logger.info(`[findBuildProductsPathAsync] found simulator products: ${fullPath}`);
      return fullPath;
    }
  } catch {
    // No Products directory
  }

  logger.info('[findBuildProductsPathAsync] no build products found');
  return null;
}
