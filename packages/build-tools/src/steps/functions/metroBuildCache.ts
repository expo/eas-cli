import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import fg from 'fast-glob';
import fs from 'fs/promises';
import nullthrows from 'nullthrows';
import path from 'path';
import * as tar from 'tar';

import { downloadCacheAsync } from './restoreCache';
import { uploadCacheAsync } from './saveCache';
import { TurtleFetchError } from '../../utils/turtleFetch';

// Enabled with EAS_METRO_CACHE=1. Requires the two-store support in @expo/metro-config.
// Stable logical paths keep the cache version independent of job directories.
const CACHE_PATHS = ['metro-transform-cache-v1'];
const CACHE_ENTRY = /^[0-9a-f]{2}\/[0-9a-f]+\.mp$/;

type CacheOptions = {
  logger: bunyan;
  platform: Platform;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
};

function getCacheRequest({ platform, env, secrets, logger }: CacheOptions) {
  return {
    logger,
    platform,
    jobId: nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set'),
    expoApiServerURL: nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set'),
    robotAccessToken: nullthrows(secrets?.robotAccessToken, 'Robot access token is required'),
    key: `${platform}-metro-transform-v1`,
    paths: CACHE_PATHS,
  };
}

export async function restoreMetroCacheAsync(
  options: CacheOptions & { cacheDirectory: string }
): Promise<Record<string, string>> {
  const { env, logger, cacheDirectory } = options;
  if (env.EAS_METRO_CACHE !== '1') {
    return {};
  }
  const output = path.resolve(cacheDirectory, 'output');
  const restored = path.resolve(cacheDirectory, 'restored');
  const cacheEnv = {
    EAS_METRO_CACHE_OUTPUT_DIR: output,
    EAS_METRO_CACHE_RESTORE_DIR: restored,
  };
  // Repeated restore steps must keep results from earlier bundle commands.
  if (env.EAS_METRO_CACHE_OUTPUT_DIR === output && env.EAS_METRO_CACHE_RESTORE_DIR === restored) {
    return cacheEnv;
  }

  let archivePath: string | undefined;
  try {
    await fs.rm(cacheDirectory, { recursive: true, force: true });
    await fs.mkdir(output, { recursive: true });
    await fs.mkdir(restored, { recursive: true });
  } catch (err) {
    logger.warn({ err }, 'Failed to prepare Metro cache directories');
    return {};
  }
  try {
    const result = await downloadCacheAsync({ ...getCacheRequest(options), keyPrefixes: [] });
    archivePath = result.archivePath;
    await tar.extract({
      file: archivePath,
      cwd: restored,
      strict: true,
      // Only accept binary store entries, without temporary files or links.
      filter: (entryPath, entry) =>
        CACHE_ENTRY.test(entryPath) && 'type' in entry && entry.type === 'File',
    });
    logger.info('Restored Metro transform cache');
  } catch (err) {
    try {
      await fs.rm(restored, { recursive: true, force: true });
      await fs.mkdir(restored, { recursive: true });
    } catch (cleanupError) {
      logger.warn({ err: cleanupError }, 'Failed to discard incomplete Metro cache');
      return {};
    }
    if (err instanceof TurtleFetchError && err.response?.status === 404) {
      logger.info('No Metro transform cache found');
    } else {
      logger.warn({ err }, 'Failed to restore Metro transform cache');
    }
  } finally {
    if (archivePath) {
      await fs.rm(archivePath, { force: true }).catch(err => {
        logger.warn({ err }, 'Failed to remove Metro cache archive');
      });
    }
  }
  return cacheEnv;
}

export async function saveMetroCacheAsync(options: CacheOptions): Promise<void> {
  const { env, logger } = options;
  const output = env.EAS_METRO_CACHE_OUTPUT_DIR;
  if (env.EAS_METRO_CACHE !== '1' || !output || !env.EAS_METRO_CACHE_RESTORE_DIR) {
    return;
  }
  let archivePath: string | undefined;
  try {
    const files = (
      await fg('[0-9a-f][0-9a-f]/*.mp', { cwd: output, followSymbolicLinks: false })
    ).filter(file => CACHE_ENTRY.test(file));
    if (files.length === 0) {
      logger.info('No Metro transform cache entries to save');
      return;
    }
    // Run after bundling processes exit. Archive only the first store: reused and
    // new transforms. Unused restored entries are excluded from the next archive.
    archivePath = path.join(path.dirname(output), 'cache.tar.gz');
    await tar.create({ file: archivePath, cwd: output, gzip: true }, files);
    const { size } = await fs.stat(archivePath);
    await uploadCacheAsync({
      ...getCacheRequest(options),
      archivePath,
      size,
      // Refresh the working set even when the lockfile does not change.
      force: true,
    });
    logger.info(`Saved ${files.length} Metro transform cache entries`);
  } catch (err) {
    logger.warn({ err }, 'Failed to save Metro transform cache');
  } finally {
    if (archivePath) {
      await fs.rm(archivePath, { force: true }).catch(err => {
        logger.warn({ err }, 'Failed to remove Metro cache archive');
      });
    }
  }
}
