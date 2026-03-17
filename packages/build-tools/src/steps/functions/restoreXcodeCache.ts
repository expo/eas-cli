import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction } from '@expo/steps';
import fs from 'fs';
import nullthrows from 'nullthrows';
import path from 'path';

import { downloadCacheAsync } from './restoreCache';
import { generateXcodeCacheKeyAsync, XCODE_CACHE_KEY_PREFIX } from '../../utils/xcodeCacheKey';
import { TurtleFetchError } from '../../utils/turtleFetch';

// Stable path outside DerivedData where cached pod products are restored.
// xcodebuild archive wipes ArchiveIntermediates, so products must live elsewhere.
export const PODS_CACHE_DIR = '/tmp/pods-cache';

export function createRestoreXcodeCacheFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'restore_xcode_cache',
    name: 'Restore Xcode Cache',
    __metricsId: 'eas/restore_xcode_cache',
    fn: async (stepCtx, { env }) => {
      const { logger } = stepCtx;
      const workingDirectory = stepCtx.workingDirectory;

      await restoreXcodeCacheAsync({
        logger,
        workingDirectory,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });
    },
  });
}

export async function restoreXcodeCacheAsync({
  logger,
  workingDirectory,
  env,
  secrets,
  simulator,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
  simulator?: boolean;
}): Promise<boolean> {
  if (env.XCODE_CACHE !== '1') {
    return false;
  }

  const robotAccessToken = nullthrows(
    secrets?.robotAccessToken,
    'Robot access token is required for cache operations'
  );
  const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');

  try {
    const cacheKey = await generateXcodeCacheKeyAsync(workingDirectory, simulator);
    logger.info(`Restoring Xcode cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');

    const { archivePath, matchedKey } = await downloadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      paths: ['pods-products-v2'],
      key: cacheKey,
      keyPrefixes: [`${XCODE_CACHE_KEY_PREFIX}${simulator ? 'sim' : 'device'}-`],
      platform: Platform.IOS,
    });

    // Extract to a stable path outside DerivedData.
    // xcodebuild archive wipes ArchiveIntermediates, so we can't put products there.
    await fs.promises.mkdir(PODS_CACHE_DIR, { recursive: true });

    const { execSync } = require('child_process');
    execSync(`tar xzf ${archivePath} -C ${PODS_CACHE_DIR}`);

    // Modulemap files contain hardcoded absolute paths from the original build
    // (e.g. .../BuildProductsPath/Release-iphoneos/Expo/Swift.h).
    // Rewrite them to point to the cache directory instead.
    await rewriteModulemapPathsAsync(PODS_CACHE_DIR, logger);

    logger.info(
      `Xcode cache restored to ${PODS_CACHE_DIR} ${matchedKey === cacheKey ? '(direct hit)' : '(prefix match)'}`
    );
    return true;
  } catch (err: unknown) {
    if (err instanceof TurtleFetchError && err.response?.status === 404) {
      logger.info('No Xcode cache found for this key');
    } else {
      logger.warn('Failed to restore Xcode cache: ', err);
    }
    return false;
  }
}

/**
 * Rewrite absolute header paths inside .modulemap files.
 * Original paths look like: /.../BuildProductsPath/Release-iphoneos/Expo/Swift.h
 * We replace everything up to and including Release-iphoneos/ (or Release-iphonesimulator/)
 * with the cache directory path.
 */
async function rewriteModulemapPathsAsync(cacheDir: string, logger: bunyan): Promise<void> {
  const { execSync } = require('child_process');

  // Find all .modulemap files in the cache
  let modulemapFiles: string;
  try {
    modulemapFiles = execSync(`find ${cacheDir} -name "*.modulemap"`, { encoding: 'utf-8' }).trim();
  } catch {
    return;
  }

  if (!modulemapFiles) {
    return;
  }

  let patchCount = 0;
  for (const filePath of modulemapFiles.split('\n')) {
    if (!filePath) continue;
    let content = await fs.promises.readFile(filePath, 'utf-8');
    // Match absolute paths ending with /Release-<platform>/ (iphoneos, iphonesimulator, appletvos, etc.)
    const replaced = content.replace(/\"[^"]*\/Release-[a-z]+\//g, `"${cacheDir}/`);
    if (replaced !== content) {
      await fs.promises.writeFile(filePath, replaced);
      patchCount++;
    }
  }
  logger.info(`Rewrote paths in ${patchCount} modulemap files`);
}
