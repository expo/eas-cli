import { Ios, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  spawnAsync,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'fs';
import nullthrows from 'nullthrows';
import path from 'path';

import { sendCcacheStatsAsync } from './ccacheStats';
import { decompressCacheAsync, downloadCacheAsync, downloadPublicCacheAsync } from './restoreCache';
import {
  CACHE_KEY_PREFIX_BY_PLATFORM,
  generateDefaultBuildCacheKeyAsync,
  getCcachePath,
} from '../../utils/cacheKey';
import { TurtleFetchError } from '../../utils/turtleFetch';
import { XCODE_CACHE_KEY_PREFIX, generateXcodeCacheKeyAsync } from '../../utils/xcodeCacheKey';

// Stable path outside DerivedData where cached pod products are restored.
// xcodebuild archive wipes ArchiveIntermediates, so products must live elsewhere.
export const PODS_CACHE_DIR = '/tmp/pods-cache';

export function createRestoreBuildCacheFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'restore_build_cache',
    name: 'Restore Cache',
    __metricsId: 'eas/restore_build_cache',
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

      await restoreCcacheAsync({
        logger,
        workingDirectory,
        platform,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });

      if (platform === Platform.IOS) {
        const simulator = (stepCtx.global.staticContext.job as Ios.Job).simulator;
        const cacheHit = await restoreXcodeCacheAsync({
          logger,
          workingDirectory,
          env,
          secrets: stepCtx.global.staticContext.job.secrets,
          simulator,
        });
        await patchPodsXcodeprojAsync({
          logger,
          workingDirectory,
          env,
          cacheHit,
        });
      }
    },
  });
}

export function createCacheStatsBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'cache_stats',
    name: 'Cache Stats',
    __metricsId: 'eas/cache_stats',
    fn: async (stepCtx, { env }) => {
      const platform = stepCtx.global.staticContext.job.platform;
      if (!platform) {
        stepCtx.logger.warn('Platform not set, skipping cache stats');
        return;
      }
      await cacheStatsAsync({
        logger: stepCtx.logger,
        env,
        secrets: stepCtx.global.staticContext.job.secrets,
      });
    },
  });
}

export async function restoreCcacheAsync({
  logger,
  workingDirectory,
  platform,
  env,
  secrets,
}: {
  logger: bunyan;
  workingDirectory: string;
  platform: Platform;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  const enabled =
    env.EAS_RESTORE_CACHE === '1' || (env.EAS_USE_CACHE === '1' && env.EAS_RESTORE_CACHE !== '0');

  if (!enabled) {
    return;
  }
  const robotAccessToken = nullthrows(
    secrets?.robotAccessToken,
    'Robot access token is required for cache operations'
  );
  const expoApiServerURL = nullthrows(env.__API_SERVER_URL, '__API_SERVER_URL is not set');
  const cachePath = getCcachePath(env);

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
    // Zero ccache stats for accurate tracking
    await asyncResult(
      spawnAsync('ccache', ['--zero-stats'], {
        env,
        stdio: 'pipe',
      })
    );

    const cacheKey = await generateDefaultBuildCacheKeyAsync(workingDirectory, platform);
    logger.info(`Restoring cache key: ${cacheKey}`);

    const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
    const { archivePath, matchedKey } = await downloadCacheAsync({
      logger,
      jobId,
      expoApiServerURL,
      robotAccessToken,
      paths: [cachePath],
      key: cacheKey,
      keyPrefixes: [CACHE_KEY_PREFIX_BY_PLATFORM[platform]],
      platform,
    });

    await decompressCacheAsync({
      archivePath,
      workingDirectory,
      verbose: env.EXPO_DEBUG === '1',
      logger,
    });

    logger.info(
      `Cache restored successfully ${matchedKey === cacheKey ? '(direct hit)' : '(prefix match)'}`
    );
  } catch (err: unknown) {
    if (err instanceof TurtleFetchError && err.response?.status === 404) {
      logger.info('No cache found for this key');
    } else {
      logger.warn('Failed to restore cache: ', err);
    }
    if (env.EAS_USE_PUBLIC_CACHE === '1') {
      try {
        logger.info('Downloading public cache...');
        const { archivePath } = await downloadPublicCacheAsync({
          logger,
          expoApiServerURL,
          robotAccessToken,
          paths: [cachePath],
          platform,
        });
        await decompressCacheAsync({
          archivePath,
          workingDirectory,
          verbose: env.EXPO_DEBUG === '1',
          logger,
        });
      } catch (err: unknown) {
        logger.warn({ err }, 'Failed to download public cache');
      }
    }
  }
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
  if (env.EAS_XCODE_CACHE !== '1') {
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

    await fs.promises.mkdir(PODS_CACHE_DIR, { recursive: true });

    await spawn('tar', ['xzf', archivePath, '-C', PODS_CACHE_DIR]);

    // Modulemap files contain hardcoded absolute paths from the original build.
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

async function rewriteModulemapPathsAsync(cacheDir: string, logger: bunyan): Promise<void> {
  let modulemapFiles: string;
  try {
    const result = await spawn('find', [cacheDir, '-name', '*.modulemap'], { stdio: 'pipe' });
    modulemapFiles = result.stdout.trim();
  } catch {
    return;
  }

  if (!modulemapFiles) {
    return;
  }

  let patchCount = 0;
  for (const filePath of modulemapFiles.split('\n')) {
    if (!filePath) continue;
    const content = await fs.promises.readFile(filePath, 'utf-8');
    // Match absolute paths ending with /Release-<platform>/ (iphoneos, iphonesimulator, etc.)
    const replaced = content.replace(/"[^"]*\/Release-[a-z]+\//g, `"${cacheDir}/`);
    if (replaced !== content) {
      await fs.promises.writeFile(filePath, replaced);
      patchCount++;
    }
  }
  logger.info(`Rewrote paths in ${patchCount} modulemap files`);
}

const PATCH_RUBY_SCRIPT = `
require 'xcodeproj'

project = Xcodeproj::Project.open('ios/Pods/Pods.xcodeproj')

umbrella_targets = project.native_targets.select { |t| t.name.start_with?('Pods-') }
abort "ERROR: No Pods-* umbrella targets found!" if umbrella_targets.empty?

umbrella_names = umbrella_targets.map(&:name)
puts "Keeping umbrella targets: #{umbrella_names.join(', ')}"

pod_targets = project.native_targets.reject { |t| t.name.start_with?('Pods-') }
puts "Found #{pod_targets.size} pod targets to remove"

umbrella_targets.each do |umbrella|
  deps = umbrella.dependencies.to_a
  deps.each { |dep| dep.remove_from_project }
  puts "Cleared #{deps.size} dependencies from #{umbrella.name}"
end

pod_targets.each do |target|
  target.remove_from_project
end

project.save
puts "Saved — #{project.native_targets.size} target(s) remaining"
`;

export async function patchPodsXcodeprojAsync({
  logger,
  workingDirectory,
  env,
  cacheHit,
}: {
  logger: bunyan;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  cacheHit: boolean;
}): Promise<void> {
  if (env.EAS_XCODE_CACHE !== '1' || !cacheHit) {
    return;
  }

  logger.info('Patching Pods.xcodeproj to remove pod targets...');

  await spawnAsync('ruby', ['-e', PATCH_RUBY_SCRIPT], {
    cwd: workingDirectory,
    logger,
    env,
    stdio: 'pipe',
  });

  logger.info('Pods.xcodeproj patched successfully');

  // Point PODS_CONFIGURATION_BUILD_DIR to the stable cache directory
  // so Xcode finds pre-built products there instead of in DerivedData
  await patchPodXcconfigAsync(workingDirectory, logger);

  logger.info('Pods xcconfig patched successfully');
}

async function patchPodXcconfigAsync(workingDirectory: string, logger: bunyan): Promise<void> {
  const targetSupportDir = path.join(workingDirectory, 'ios', 'Pods', 'Target Support Files');

  let patchCount = 0;
  const entries = await fs.promises.readdir(targetSupportDir);
  for (const entry of entries) {
    if (!entry.startsWith('Pods-')) {
      continue;
    }
    const dir = path.join(targetSupportDir, entry);
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) {
      continue;
    }
    const files = await fs.promises.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.xcconfig')) {
        continue;
      }
      const filePath = path.join(dir, file);
      let content = await fs.promises.readFile(filePath, 'utf-8');
      if (content.includes('PODS_CONFIGURATION_BUILD_DIR')) {
        content = content.replace(
          /PODS_CONFIGURATION_BUILD_DIR\s*=\s*.*/g,
          `PODS_CONFIGURATION_BUILD_DIR = ${PODS_CACHE_DIR}`
        );
        await fs.promises.writeFile(filePath, content);
        patchCount++;
        logger.info(`Patched ${filePath}`);
      }
    }
  }
  logger.info(`Patched ${patchCount} xcconfig files`);
}

export async function cacheStatsAsync({
  logger,
  env,
  secrets,
}: {
  logger: bunyan;
  env: Record<string, string | undefined>;
  secrets?: { robotAccessToken?: string };
}): Promise<void> {
  const enabled =
    env.EAS_RESTORE_CACHE === '1' || (env.EAS_USE_CACHE === '1' && env.EAS_RESTORE_CACHE !== '0');

  if (!enabled) {
    return;
  }

  // Check if ccache is installed
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

  await asyncResult(
    spawnAsync('ccache', ['--show-stats', '-v'], {
      env,
      logger,
      stdio: 'pipe',
    })
  );

  const robotAccessToken = secrets?.robotAccessToken;
  const expoApiServerURL = env.__API_SERVER_URL;
  const buildId = env.EAS_BUILD_ID;

  if (robotAccessToken && expoApiServerURL && buildId) {
    await sendCcacheStatsAsync({
      env,
      expoApiServerURL,
      robotAccessToken,
      buildId,
    });
  }
}
