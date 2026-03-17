import { Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction } from '@expo/steps';
import fs from 'fs';
import nullthrows from 'nullthrows';
import os from 'os';
import path from 'path';

import { AndroidConfig } from '@expo/config-plugins';
import spawn from '@expo/turtle-spawn';

import { downloadCacheAsync } from './restoreCache';
import { GRADLE_CACHE_KEY_PREFIX, generateGradleCacheKeyAsync } from '../../utils/gradleCacheKey';
import { TurtleFetchError } from '../../utils/turtleFetch';

const GRADLE_CACHES_DIR = '.gradle/caches';

export function createRestoreGradleCacheFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'restore_gradle_cache',
    name: 'Restore Gradle Cache',
    __metricsId: 'eas/restore_gradle_cache',
    fn: async (stepCtx, { env }) => {
      const { logger } = stepCtx;
      const workingDirectory = stepCtx.workingDirectory;
      await restoreGradleCacheAsync({
        logger,
        workingDirectory,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });
    },
  });
}

export async function restoreGradleCacheAsync({
  logger,
  workingDirectory,
  env,
  secrets,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<boolean> {
  if (env.EAS_GRADLE_CACHE !== '1') {
    return false;
  }

  const gradlePropertiesPath = path.join(workingDirectory, 'android', 'gradle.properties');
  const gradlePropertiesContent = await fs.promises.readFile(gradlePropertiesPath, 'utf-8');
  const properties = AndroidConfig.Properties.parsePropertiesFile(gradlePropertiesContent);

  let modified = false;
  if (!properties.some(p => p.type === 'property' && p.key === 'org.gradle.caching')) {
    properties.push({ type: 'property', key: 'org.gradle.caching', value: 'true' });
    modified = true;
  }
  if (!properties.some(p => p.type === 'property' && p.key === 'org.gradle.cache.cleanup')) {
    properties.push({ type: 'property', key: 'org.gradle.cache.cleanup', value: 'ALWAYS' });
    modified = true;
  }
  if (modified) {
    await fs.promises.writeFile(
      gradlePropertiesPath,
      AndroidConfig.Properties.propertiesListToString(properties)
    );
  }

  const robotAccessToken = nullthrows(
    secrets?.robotAccessToken,
    'Robot access token is required for cache operations'
  );
  const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');

  try {
    const cacheKey = await generateGradleCacheKeyAsync(workingDirectory);
    logger.info(`Restoring Gradle cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const gradleCachesPath = path.join(os.homedir(), GRADLE_CACHES_DIR);

    const { archivePath, matchedKey } = await downloadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      paths: ['gradle-caches'],
      key: cacheKey,
      keyPrefixes: [GRADLE_CACHE_KEY_PREFIX],
      platform: Platform.ANDROID,
    });

    await fs.promises.mkdir(gradleCachesPath, { recursive: true });
    await spawn('tar', ['xzf', archivePath, '-C', gradleCachesPath], { logger });

    logger.info(
      `Gradle cache restored to ${gradleCachesPath} ${matchedKey === cacheKey ? '(direct hit)' : '(prefix match)'}`
    );
    return true;
  } catch (err: unknown) {
    if (err instanceof TurtleFetchError && err.response?.status === 404) {
      logger.info('No Gradle cache found for this key');
    } else {
      logger.warn('Failed to restore Gradle cache: ', err);
    }
    return false;
  }
}
