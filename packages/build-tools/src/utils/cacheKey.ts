import { Platform } from '@expo/eas-build-job';
import * as PackageManagerUtils from '@expo/package-manager';
import { hashFiles } from '@expo/steps';
import assert from 'assert';
import os from 'os';
import path from 'path';

import { findPackagerRootDir } from './packageManager';

const IOS_DEVICE_CACHE_KEY_PREFIX = 'ios-device-ccache-';
const IOS_SIMULATOR_CACHE_KEY_PREFIX = 'ios-simulator-ccache-';
const ANDROID_CACHE_KEY_PREFIX = 'android-ccache-';
const PUBLIC_IOS_CACHE_KEY_PREFIX = 'public-ios-ccache-';
const PUBLIC_ANDROID_CACHE_KEY_PREFIX = 'public-android-ccache-';
const DARWIN_CACHE_PATH = 'Library/Caches/ccache';
const LINUX_CACHE_PATH = '.cache/ccache';

export type CcacheBuildTarget =
  | { platform: Platform.ANDROID }
  | { platform: Platform.IOS; simulator: boolean };

export function getCcacheKeyPrefix(target: CcacheBuildTarget): string {
  if (target.platform === Platform.IOS) {
    return target.simulator ? IOS_SIMULATOR_CACHE_KEY_PREFIX : IOS_DEVICE_CACHE_KEY_PREFIX;
  }
  return ANDROID_CACHE_KEY_PREFIX;
}

export const PUBLIC_CACHE_KEY_PREFIX_BY_PLATFORM: Record<Platform, string> = {
  [Platform.ANDROID]: PUBLIC_ANDROID_CACHE_KEY_PREFIX,
  [Platform.IOS]: PUBLIC_IOS_CACHE_KEY_PREFIX,
};

const PATH_BY_PLATFORM: Record<string, string> = {
  darwin: DARWIN_CACHE_PATH,
  linux: LINUX_CACHE_PATH,
};

export function getCcachePath(env: Record<string, string | undefined>): string {
  assert(env.HOME, 'Failed to infer directory: $HOME environment variable is empty.');
  return path.join(env.HOME, PATH_BY_PLATFORM[os.platform()]);
}

export async function generateDefaultBuildCacheKeyAsync(
  workingDirectory: string,
  target: CcacheBuildTarget
): Promise<string> {
  // This will resolve which package manager and use the relevant lock file
  // The lock file hash is the key and ensures cache is fresh
  const packagerRunDir = findPackagerRootDir(workingDirectory);
  const manager = PackageManagerUtils.createForProject(packagerRunDir);
  const lockPath = path.join(packagerRunDir, manager.lockFile);

  try {
    return `${getCcacheKeyPrefix(target)}${hashFiles([lockPath])}`;
  } catch (err: any) {
    throw new Error(`Failed to read lockfile for cache key generation: ${err.message}`);
  }
}
