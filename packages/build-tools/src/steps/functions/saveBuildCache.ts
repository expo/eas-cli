import { Ios, Platform } from '@expo/eas-build-job';
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
import path from 'path';

import { compressCacheAsync, uploadCacheAsync } from './saveCache';
import { generateDefaultBuildCacheKeyAsync, getCcachePath } from '../../utils/cacheKey';
import { generateXcodeCacheKeyAsync } from '../../utils/xcodeCacheKey';

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

      if (platform === Platform.IOS) {
        const simulator = (stepCtx.global.staticContext.job as Ios.Job).simulator;
        await saveXcodeCacheAsync({
          logger,
          workingDirectory,
          env,
          secrets: stepCtx.global.staticContext.job.secrets,
          simulator,
        });
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

export async function saveXcodeCacheAsync({
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
}): Promise<void> {
  if (env.EAS_XCODE_CACHE !== '1') {
    return;
  }

  const productsPath = await findBuildProductsPathAsync(workingDirectory, logger);
  if (!productsPath) {
    logger.warn('No build products found, skipping Xcode cache save');
    return;
  }

  logger.info(`Found build products at: ${productsPath}`);

  const cachePaths = ['pods-products-v2'];

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
      paths: ['.'],
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

async function findBuildProductsPathAsync(
  workingDirectory: string,
  logger: bunyan
): Promise<string | null> {
  const iosBuildDir = path.join(workingDirectory, 'ios', 'build');

  // Archive build: Build/Intermediates.noindex/ArchiveIntermediates/<AppName>/BuildProductsPath/Release-iphoneos/
  const archiveIntermediatesDir = path.join(
    iosBuildDir,
    'Build',
    'Intermediates.noindex',
    'ArchiveIntermediates'
  );
  try {
    const entries = await fs.promises.readdir(archiveIntermediatesDir);
    for (const entry of entries) {
      const buildProductsPath = path.join(archiveIntermediatesDir, entry, 'BuildProductsPath');
      try {
        const configs = await fs.promises.readdir(buildProductsPath);
        const releaseDir = configs.find(c => c.startsWith('Release-'));
        if (releaseDir) {
          const fullPath = path.join(buildProductsPath, releaseDir);
          logger.info(`Found archive build products: ${fullPath}`);
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
    const releaseDir = configs.find(c => c.startsWith('Release-'));
    if (releaseDir) {
      const fullPath = path.join(productsDir, releaseDir);
      logger.info(`Found simulator build products: ${fullPath}`);
      return fullPath;
    }
  } catch {
    // No Products directory
  }

  logger.info('No build products found');
  return null;
}
