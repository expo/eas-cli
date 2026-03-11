import {
  BUN_LOCK_FILE,
  BUN_TEXT_LOCK_FILE,
  NPM_LOCK_FILE,
  PNPM_LOCK_FILE,
  YARN_LOCK_FILE,
  resolveWorkspaceRoot,
} from '@expo/package-manager';
import { Platform } from '@expo/eas-build-job';
import {
  LockfileData,
  findLockfileMismatches,
  findPeerDependencyConflicts,
  parseLockfile,
} from '@expo/lockfile-utils';
import fs from 'fs-extra';
import path from 'path';

import { CommonContext } from './context';
import Log from '../log';

const SKIP_HINT =
  'To skip this check, set the EAS_BUILD_SKIP_LOCKFILE_CHECK=1 environment variable.';

interface LockfileInfo {
  /** Filename of the lockfile (e.g. 'yarn.lock') */
  filename: string;
  /** Package manager name for display (e.g. 'yarn') */
  managerName: string;
}

const LOCKFILE_BY_MANAGER: Record<string, LockfileInfo> = {
  npm: { filename: NPM_LOCK_FILE, managerName: 'npm' },
  yarn: { filename: YARN_LOCK_FILE, managerName: 'yarn' },
  pnpm: { filename: PNPM_LOCK_FILE, managerName: 'pnpm' },
  bun: { filename: BUN_LOCK_FILE, managerName: 'bun' },
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

async function readLockfileDataAsync(
  projectDir: string,
  lockfilePath: string,
  manager: string
): Promise<{ lockfileData: LockfileData; packageJson: Record<string, unknown> } | null> {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (!(await fs.pathExists(packageJsonPath))) {
    return null;
  }

  const packageJson = await fs.readJson(packageJsonPath);
  const lockfileContent = await fs.readFile(lockfilePath, 'utf-8');
  const lockfileData = parseLockfile(lockfileContent, manager, lockfilePath);
  if (!lockfileData) {
    return null;
  }

  return { lockfileData, packageJson };
}

/**
 * Pre-flight lockfile validation for `eas build`. Catches common lockfile
 * problems before uploading to the builder.
 */
export async function checkLockfileAsync<T extends Platform>(
  ctx: CommonContext<T>
): Promise<void> {
  if (process.env.EAS_BUILD_SKIP_LOCKFILE_CHECK) {
    Log.warn('Skipping lockfile validation (EAS_BUILD_SKIP_LOCKFILE_CHECK is set).');
    return;
  }

  const { projectDir, requiredPackageManager, vcsClient } = ctx;

  // --- 1. Lockfile existence ---
  if (!requiredPackageManager) {
    Log.error('No lockfile found in the project directory.');
    Log.error(
      'A lockfile is required to ensure deterministic dependency installation on the EAS builder.'
    );
    Log.error(
      'Run your package manager\'s install command (e.g. "npm install") to generate one, then commit it to version control.'
    );
    Log.error(SKIP_HINT);
    process.exit(1);
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
    Log.error(SKIP_HINT);
    process.exit(1);
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
    Log.error(SKIP_HINT);
    process.exit(1);
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
    Log.error(SKIP_HINT);
    process.exit(1);
    return;
  }

  // --- 4 & 5. Parse lockfile for dependency sync and peer dep checks ---
  // For bun, prefer the text lockfile for parsing (bun.lockb is binary)
  const parsableLockfilePath =
    requiredPackageManager === 'bun'
      ? (await findLockfileAsync(projectDir, BUN_TEXT_LOCK_FILE)) ?? lockfilePath
      : lockfilePath;

  const parsed = await readLockfileDataAsync(
    projectDir,
    parsableLockfilePath,
    requiredPackageManager
  );

  if (!parsed) {
    return; // Can't parse — skip remaining checks
  }

  // --- 4. Lockfile out of sync ---
  const mismatches = findLockfileMismatches(parsed.packageJson, parsed.lockfileData);

  if (mismatches.length > 0) {
    Log.error('Lockfile is out of sync with package.json:');
    for (const m of mismatches) {
      Log.error(
        `  ${m.name}: package.json requires ${m.specifier}, but lockfile has ${m.lockedVersion}`
      );
    }
    Log.error(
      `Run "${requiredPackageManager} install" to update your lockfile, then commit the changes.`
    );
    Log.error(SKIP_HINT);
    process.exit(1);
    return;
  }

  // --- 5. Peer dependency conflicts ---
  const peerConflicts = findPeerDependencyConflicts(parsed.packageJson, parsed.lockfileData);

  if (peerConflicts.length > 0) {
    Log.error('Peer dependency conflicts detected:');
    for (const c of peerConflicts) {
      Log.error(
        `  ${c.source}@${c.sourceVersion} requires peer ${c.peer}@"${c.peerRange}", but ${c.peer}@${c.installedVersion} is installed`
      );
    }
    Log.error(
      'Update the conflicting packages to compatible versions, then run ' +
        `"${requiredPackageManager} install" and commit the changes.`
    );
    Log.error(SKIP_HINT);
    process.exit(1);
    return;
  }
}
