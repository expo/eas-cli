import * as PackageManagerUtils from '@expo/package-manager';
import { hashFiles } from '@expo/steps';
import path from 'path';

import { findPackagerRootDir } from './packageManager';

export const GRADLE_CACHE_KEY_PREFIX = 'android-gradle-cache-';

export async function generateGradleCacheKeyAsync(workingDirectory: string): Promise<string> {
  const packagerRunDir = findPackagerRootDir(workingDirectory);
  const manager = PackageManagerUtils.createForProject(packagerRunDir);
  const lockPath = path.join(packagerRunDir, manager.lockFile);

  try {
    return `${GRADLE_CACHE_KEY_PREFIX}${hashFiles([lockPath])}`;
  } catch (err: unknown) {
    throw new Error(
      `Failed to read lockfile for Gradle cache key generation: ${err instanceof Error ? err.message : err}`
    );
  }
}
