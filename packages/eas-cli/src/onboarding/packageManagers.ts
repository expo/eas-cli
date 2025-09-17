import spawnAsync from '@expo/spawn-async';

export type PackageManager = 'bun' | 'yarn' | 'pnpm' | 'npm';

export function getLockfileForPackageManager(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'bun':
      return 'bun.lockb';
    case 'yarn':
      return 'yarn.lock';
    case 'pnpm':
      return 'pnpm-lock.yaml';
    case 'npm':
      return 'package-lock.json';
  }
}

export async function getAvailablePackageManagersAsync(): Promise<PackageManager[]> {
  const availablePackageManagers: PackageManager[] = [];
  if (await isBunAvailableAsync()) {
    availablePackageManagers.push('bun');
  }
  if (await isYarnAvailableAsync()) {
    availablePackageManagers.push('yarn');
  }
  if (await isPnpmAvailableAsync()) {
    availablePackageManagers.push('pnpm');
  }
  availablePackageManagers.push('npm');
  return availablePackageManagers;
}

async function isBunAvailableAsync(): Promise<boolean> {
  try {
    await spawnAsync('bun', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function isYarnAvailableAsync(): Promise<boolean> {
  try {
    await spawnAsync('yarn', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function isPnpmAvailableAsync(): Promise<boolean> {
  try {
    await spawnAsync('pnpm', ['--version']);
    return true;
  } catch {
    return false;
  }
}
