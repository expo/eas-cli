import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction } from '@expo/steps';
import fs from 'fs';
import nullthrows from 'nullthrows';
import path from 'path';

import { decompressCacheAsync, downloadCacheAsync } from './restoreCache';
import { generateXcodeCacheKeyAsync, XCODE_CACHE_KEY_PREFIX } from '../../utils/xcodeCacheKey';
import { TurtleFetchError } from '../../utils/turtleFetch';

export const XCODE_CACHE_HIT_FLAG = '/tmp/xcode_cache_hit';

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
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  if (env.XCODE_CACHE !== '1') {
    return;
  }

  const robotAccessToken = nullthrows(
    secrets?.robotAccessToken,
    'Robot access token is required for cache operations'
  );
  const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');

  try {
    const cacheKey = await generateXcodeCacheKeyAsync(workingDirectory);
    logger.info(`Restoring Xcode cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');

    const { archivePath, matchedKey } = await downloadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      paths: [path.join('ios', 'build', 'Build', 'Products')],
      key: cacheKey,
      keyPrefixes: [XCODE_CACHE_KEY_PREFIX],
      platform: Platform.IOS,
    });

    await decompressCacheAsync({
      archivePath,
      workingDirectory,
      verbose: env.EXPO_DEBUG === '1',
      logger,
    });

    // Signal cache hit for downstream steps
    await fs.promises.writeFile(XCODE_CACHE_HIT_FLAG, '1');

    logger.info(
      `Xcode cache restored successfully ${matchedKey === cacheKey ? '(direct hit)' : '(prefix match)'}`
    );
  } catch (err: unknown) {
    if (err instanceof TurtleFetchError && err.response?.status === 404) {
      logger.info('No Xcode cache found for this key');
    } else {
      logger.warn('Failed to restore Xcode cache: ', err);
    }
  }
}
