#!/usr/bin/env node

import { execSync } from 'child_process';

import * as PackageManager from '@expo/package-manager';

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn';

export function resolvePackageManager(): PackageManagerName {
  // Attempt to detect if the user started the command using `yarn` or `pnpm`
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent?.startsWith('yarn')) {
    return 'yarn';
  } else if (userAgent?.startsWith('pnpm')) {
    return 'pnpm';
  } else if (userAgent?.startsWith('npm')) {
    return 'npm';
  }

  // Try availability
  if (isPackageManagerAvailable('yarn')) {
    return 'yarn';
  } else if (isPackageManagerAvailable('pnpm')) {
    return 'pnpm';
  }

  return 'npm';
}

export function formatSelfCommand(): string {
  const packageManager = resolvePackageManager();
  switch (packageManager) {
    case 'pnpm':
      return `pnpx create-eas-build-function`;
    case 'yarn':
    case 'npm':
    default:
      return `npx create-eas-build-function`;
  }
}

export function isPackageManagerAvailable(manager: PackageManagerName): boolean {
  try {
    execSync(`${manager} --version`, { stdio: 'ignore' });
    return true;
  } catch {}
  return false;
}

export async function installDependenciesAsync(
  projectRoot: string,
  packageManager: PackageManagerName,
  flags: { silent: boolean } = { silent: false }
): Promise<void> {
  const options = { cwd: projectRoot, silent: flags.silent };
  if (packageManager === 'yarn') {
    await new PackageManager.YarnPackageManager(options).installAsync();
  } else if (packageManager === 'pnpm') {
    await new PackageManager.PnpmPackageManager(options).installAsync();
  } else {
    await new PackageManager.NpmPackageManager(options).installAsync();
  }
}

export function formatRunCommand(packageManager: PackageManagerName, cmd: string): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm run ${cmd}`;
    case 'yarn':
      return `yarn ${cmd}`;
    case 'npm':
    default:
      return `npm run ${cmd}`;
  }
}
