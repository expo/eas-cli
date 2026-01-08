import spawnAsync from '@expo/turtle-spawn';
import * as PackageManagerUtils from '@expo/package-manager';
import semver from 'semver';
import { z } from 'zod';

export enum PackageManager {
  YARN = 'yarn',
  NPM = 'npm',
  PNPM = 'pnpm',
  BUN = 'bun',
}

export function resolvePackageManager(directory: string): PackageManager {
  try {
    const manager = PackageManagerUtils.resolvePackageManager(directory);
    if (manager === 'npm') {
      return PackageManager.NPM;
    } else if (manager === 'pnpm') {
      return PackageManager.PNPM;
    } else if (manager === 'bun') {
      return PackageManager.BUN;
    } else {
      return PackageManager.YARN;
    }
  } catch {
    return PackageManager.YARN;
  }
}

export function findPackagerRootDir(currentDir: string): string {
  return PackageManagerUtils.resolveWorkspaceRoot(currentDir) ?? currentDir;
}

export async function isAtLeastNpm7Async(): Promise<boolean> {
  const version = (await spawnAsync('npm', ['--version'], { stdio: 'pipe' })).stdout.trim();
  return semver.gte(version, '7.0.0');
}

export function shouldUseFrozenLockfile({
  env,
  sdkVersion,
  reactNativeVersion,
}: {
  env: Record<string, string | undefined>;
  sdkVersion: string | undefined;
  reactNativeVersion: string | undefined;
}): boolean {
  if (env.EAS_NO_FROZEN_LOCKFILE) {
    return false;
  }

  if (sdkVersion && semver.lt(sdkVersion, '53.0.0')) {
    // Before SDK 53 we could not have used frozen lockfile.
    return false;
  }

  if (reactNativeVersion && semver.lt(reactNativeVersion, '0.79.0')) {
    // Before react-native 0.79 we could not have used frozen lockfile.
    return false;
  }

  // We either don't know expo and react-native versions,
  // so we can try to use frozen lockfile, or the versions are
  // new enough that we do want to use it.
  return true;
}

const PackageJsonZ = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

export function getPackageVersionFromPackageJson({
  packageJson,
  packageName,
}: {
  packageJson: unknown;
  packageName: string;
}): string | undefined {
  const parsedPackageJson = PackageJsonZ.safeParse(packageJson);
  if (!parsedPackageJson.success) {
    return undefined;
  }

  const version =
    parsedPackageJson.data.dependencies?.[packageName] ??
    parsedPackageJson.data.devDependencies?.[packageName];
  if (!version) {
    return undefined;
  }

  return semver.coerce(version)?.version;
}
