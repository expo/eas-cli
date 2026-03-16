import * as PackageManagerUtils from '@expo/package-manager';
import { hashFiles } from '@expo/steps';
import path from 'path';

import { findPackagerRootDir } from './packageManager';

export const XCODE_CACHE_KEY_PREFIX = 'ios-xcode-cache-';

export async function generateXcodeCacheKeyAsync(
  workingDirectory: string,
  simulator?: boolean
): Promise<string> {
  const packagerRunDir = findPackagerRootDir(workingDirectory);
  const manager = PackageManagerUtils.createForProject(packagerRunDir);
  const lockPath = path.join(packagerRunDir, manager.lockFile);
  const variant = simulator ? 'sim' : 'device';

  try {
    return `${XCODE_CACHE_KEY_PREFIX}${variant}-${hashFiles([lockPath])}`;
  } catch (err: any) {
    throw new Error(`Failed to read lockfile for Xcode cache key generation: ${err.message}`);
  }
}
