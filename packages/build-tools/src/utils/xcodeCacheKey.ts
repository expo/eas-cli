import * as PackageManagerUtils from '@expo/package-manager';
import { hashFiles } from '@expo/steps';
import path from 'path';

import { findPackagerRootDir } from './packageManager';

export const XCODE_CACHE_KEY_PREFIX = 'ios-xcode-cache-';

export async function generateXcodeCacheKeyAsync(
  workingDirectory: string
): Promise<string> {
  const packagerRunDir = findPackagerRootDir(workingDirectory);
  const manager = PackageManagerUtils.createForProject(packagerRunDir);
  const lockPath = path.join(packagerRunDir, manager.lockFile);

  try {
    return `${XCODE_CACHE_KEY_PREFIX}${hashFiles([lockPath])}`;
  } catch (err: any) {
    throw new Error(`Failed to read lockfile for Xcode cache key generation: ${err.message}`);
  }
}
