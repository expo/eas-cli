import {
  BUN_LOCK_FILE,
  BUN_TEXT_LOCK_FILE,
  NPM_LOCK_FILE,
  PNPM_LOCK_FILE,
  YARN_LOCK_FILE,
  resolveWorkspaceRoot,
} from '@expo/package-manager';
import { pathExists } from 'fs-extra';
import path from 'path';

const LOCKFILE_NAMES = [
  NPM_LOCK_FILE,
  YARN_LOCK_FILE,
  PNPM_LOCK_FILE,
  BUN_LOCK_FILE,
  BUN_TEXT_LOCK_FILE,
];

async function hasLockfileAsync(dir: string): Promise<boolean> {
  for (const lockfile of LOCKFILE_NAMES) {
    if (await pathExists(path.join(dir, lockfile))) {
      return true;
    }
  }
  return false;
}

export async function ensureLockfileExistsAsync(projectDir: string): Promise<void> {
  if (await hasLockfileAsync(projectDir)) {
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(projectDir);
  if (workspaceRoot && workspaceRoot !== projectDir) {
    if (await hasLockfileAsync(workspaceRoot)) {
      return;
    }
  }

  throw new Error(
    `No lockfile found in the project directory.\n` +
      `A lockfile is required to ensure deterministic dependency installation in EAS.\n` +
      `Run your package manager's install command (e.g. "npm install") to generate one.\n` +
      `To skip this check, run this command with EAS_BUILD_SKIP_LOCKFILE_CHECK=1.`
  );
}
