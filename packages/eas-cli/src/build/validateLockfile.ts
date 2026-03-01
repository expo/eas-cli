import {
  BUN_LOCK_FILE,
  BUN_TEXT_LOCK_FILE,
  NPM_LOCK_FILE,
  PNPM_LOCK_FILE,
  YARN_LOCK_FILE,
  resolveWorkspaceRoot,
} from '@expo/package-manager';
import { Errors } from '@oclif/core';
import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import { CommonContext } from './context';
import Log, { learnMore } from '../log';

interface LockfileInfo {
  /** Filename of the lockfile (e.g. 'yarn.lock') */
  filename: string;
  /** Package manager name for display (e.g. 'yarn') */
  managerName: string;
}

const LOCKFILE_BY_MANAGER: Record<string, LockfileInfo> = {
  npm: { filename: NPM_LOCK_FILE, managerName: 'npm' },
  yarn: { filename: YARN_LOCK_FILE, managerName: 'Yarn' },
  pnpm: { filename: PNPM_LOCK_FILE, managerName: 'pnpm' },
  bun: { filename: BUN_LOCK_FILE, managerName: 'Bun' },
};

const ALL_LOCKFILES: { filename: string; manager: string }[] = [
  { filename: NPM_LOCK_FILE, manager: 'npm' },
  { filename: YARN_LOCK_FILE, manager: 'yarn' },
  { filename: PNPM_LOCK_FILE, manager: 'pnpm' },
  { filename: BUN_LOCK_FILE, manager: 'bun' },
  { filename: BUN_TEXT_LOCK_FILE, manager: 'bun' },
];

/**
 * Find the lockfile for the given filename by checking the workspace root first
 * (for monorepos), then the project directory.
 */
async function findLockfileAsync(
  projectDir: string,
  filename: string
): Promise<string | null> {
  const workspaceRoot = resolveWorkspaceRoot(projectDir);
  if (workspaceRoot) {
    const workspaceLockfile = path.join(workspaceRoot, filename);
    if (await fs.pathExists(workspaceLockfile)) {
      return workspaceLockfile;
    }
  }

  const projectLockfile = path.join(projectDir, filename);
  if (await fs.pathExists(projectLockfile)) {
    return projectLockfile;
  }

  return null;
}

/**
 * Pre-flight lockfile validation for `eas build`. Catches common lockfile
 * problems before uploading to the builder.
 *
 * All checks are hard errors — the build command exits with a non-zero code.
 */
export async function checkLockfileAsync<T extends Platform>(
  ctx: CommonContext<T>
): Promise<void> {
  const { projectDir, requiredPackageManager, vcsClient } = ctx;

  // --- 1. Lockfile existence ---
  if (!requiredPackageManager) {
    Log.error('No lockfile found in the project directory.');
    Log.error(
      'A lockfile is required to ensure deterministic dependency installation on the EAS builder.'
    );
    Log.error(
      `Run your package manager's install command (e.g. "npm install") to generate one, then commit it to version control. ${learnMore('https://docs.expo.dev/build-reference/infrastructure/')}`
    );
    Errors.exit(1);
    return;
  }

  const lockInfo = LOCKFILE_BY_MANAGER[requiredPackageManager];
  if (!lockInfo) {
    // Unknown package manager — nothing we can validate
    return;
  }

  // For bun, also check the text lockfile variant
  const lockfilePath =
    requiredPackageManager === 'bun'
      ? (await findLockfileAsync(projectDir, BUN_LOCK_FILE)) ??
        (await findLockfileAsync(projectDir, BUN_TEXT_LOCK_FILE))
      : await findLockfileAsync(projectDir, lockInfo.filename);

  if (!lockfilePath) {
    Log.error(
      `${lockInfo.managerName} lockfile (${lockInfo.filename}) not found.`
    );
    Log.error(
      `Run "${requiredPackageManager} install" to generate a lockfile, then commit it to version control.`
    );
    Errors.exit(1);
    return;
  }

  // --- 2. Lockfile tracked in VCS ---
  const rootDir = path.normalize(await vcsClient.getRootPathAsync());
  const relativeLockfilePath = path.relative(rootDir, lockfilePath);
  if (await vcsClient.isFileIgnoredAsync(relativeLockfilePath)) {
    Log.error(
      `${lockInfo.managerName} lockfile (${relativeLockfilePath}) is ignored by your version control system and won't be uploaded to the EAS builder.`
    );
    Log.error(
      'Remove the lockfile from .gitignore (and .easignore, if applicable), then commit it.'
    );
    Errors.exit(1);
    return;
  }

  // --- 3. Conflicting lockfiles ---
  const foundManagers = new Set<string>();
  for (const { filename, manager } of ALL_LOCKFILES) {
    if (await findLockfileAsync(projectDir, filename)) {
      foundManagers.add(manager);
    }
  }

  if (foundManagers.size > 1) {
    const managerList = [...foundManagers].sort().join(', ');
    Log.error(`Conflicting lockfiles detected from multiple package managers: ${managerList}.`);
    Log.error(
      'Having lockfiles from multiple package managers can cause install failures on the EAS builder. Remove the lockfiles you do not need and commit the change.'
    );
    Errors.exit(1);
    return;
  }

  // --- 4. Lockfile freshness ---
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    const [packageJsonStat, lockfileStat] = await Promise.all([
      fs.stat(packageJsonPath),
      fs.stat(lockfilePath),
    ]);

    if (packageJsonStat.mtimeMs > lockfileStat.mtimeMs) {
      Log.warn(
        `Your lockfile may be out of date — package.json has been modified more recently than ${path.basename(lockfilePath)}.`
      );
      Log.warn(
        `If you changed dependencies, run "${requiredPackageManager} install" to update your lockfile before building.`
      );
      Log.newLine();
    }
  }
}
