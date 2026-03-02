import {
  BUN_LOCK_FILE,
  BUN_TEXT_LOCK_FILE,
  NPM_LOCK_FILE,
  PNPM_LOCK_FILE,
  YARN_LOCK_FILE,
  resolveWorkspaceRoot,
} from '@expo/package-manager';
import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';
import semver from 'semver';

import { CommonContext } from './context';
import Log from '../log';

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

// --- Lockfile parsers ---
// Each returns a Map<packageName, lockedVersion> or null if parsing fails.
// Wrapped in try/catch so a parse failure silently skips the sync check.

function parseNpmLockVersions(content: string): Map<string, string> | null {
  try {
    const lockfile = JSON.parse(content);
    const packages: Record<string, { version?: string }> = lockfile.packages ?? {};
    const versions = new Map<string, string>();
    for (const [key, value] of Object.entries(packages)) {
      if (!key.startsWith('node_modules/')) {
        continue;
      }
      const rest = key.slice('node_modules/'.length);
      // Skip nested node_modules (transitive deps)
      if (rest.includes('node_modules/')) {
        continue;
      }
      if (value.version) {
        versions.set(rest, value.version);
      }
    }
    return versions;
  } catch {
    return null;
  }
}

function parseYarnLockVersions(content: string): Map<string, string> | null {
  try {
    const versions = new Map<string, string>();
    const lines = content.split('\n');
    let currentPackage: string | null = null;

    for (const line of lines) {
      // Entry header: not indented, not a comment, ends with ':'
      if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#') && line.endsWith(':')) {
        // Examples:
        //   yarn v1: react@^19.0.0:  or  "react@^19.0.0":
        //   yarn v2+: "react@npm:^19.0.0":
        const entry = line.replace(/^"/, '').replace(/:$/, '').replace(/"$/, '');
        const atIndex = entry.indexOf('@', entry.startsWith('@') ? 1 : 0);
        if (atIndex > 0) {
          currentPackage = entry.slice(0, atIndex);
        }
      }

      // Version line (indented): `  version "19.0.0"` or `  version: 19.0.0`
      if (currentPackage) {
        const versionMatch = line.match(/^\s+version:?\s+"?([^"\s]+)"?/);
        if (versionMatch) {
          if (!versions.has(currentPackage)) {
            versions.set(currentPackage, versionMatch[1]);
          }
          currentPackage = null;
        }
      }
    }
    return versions;
  } catch {
    return null;
  }
}

function parsePnpmLockVersions(content: string): Map<string, string> | null {
  try {
    const versions = new Map<string, string>();
    // Match entries in the packages section like:
    //   react@19.0.0:   or   @types/react@19.0.0:
    const packageRegex = /^ {2}((?:@[\w.-]+\/)?[\w.-]+)@(\d+[^:\s]*?):/gm;
    let match;
    while ((match = packageRegex.exec(content)) !== null) {
      if (!versions.has(match[1])) {
        versions.set(match[1], match[2]);
      }
    }
    return versions;
  } catch {
    return null;
  }
}

function parseBunLockVersions(content: string): Map<string, string> | null {
  try {
    // bun.lock is JSONC (has trailing commas) — strip them for JSON.parse
    const jsonContent = content.replace(/,(\s*[}\]])/g, '$1');
    const lockfile = JSON.parse(jsonContent);
    const packages: Record<string, unknown[]> = lockfile.packages ?? {};
    const versions = new Map<string, string>();
    for (const [name, value] of Object.entries(packages)) {
      // Format: "react": ["react@19.0.0", ...]
      if (Array.isArray(value) && typeof value[0] === 'string') {
        const entry: string = value[0];
        const atIndex = entry.lastIndexOf('@');
        if (atIndex > 0) {
          versions.set(name, entry.slice(atIndex + 1));
        }
      }
    }
    return versions;
  } catch {
    return null;
  }
}

function parseLockfileVersions(
  content: string,
  manager: string,
  lockfilePath: string
): Map<string, string> | null {
  switch (manager) {
    case 'npm':
      return parseNpmLockVersions(content);
    case 'yarn':
      return parseYarnLockVersions(content);
    case 'pnpm':
      return parsePnpmLockVersions(content);
    case 'bun':
      // bun.lockb is binary — can only parse the text variant
      if (lockfilePath.endsWith('.lockb')) {
        return null;
      }
      return parseBunLockVersions(content);
    default:
      return null;
  }
}

function isNonRegistrySpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('file:') ||
    specifier.startsWith('link:') ||
    specifier.startsWith('workspace:') ||
    specifier.startsWith('git:') ||
    specifier.startsWith('git+') ||
    specifier.startsWith('github:') ||
    specifier.startsWith('http:') ||
    specifier.startsWith('https:') ||
    specifier.startsWith('portal:') ||
    specifier === '*' ||
    specifier === 'latest' ||
    specifier === 'next'
  );
}

interface DependencyMismatch {
  name: string;
  specifier: string;
  lockedVersion: string;
}

async function findLockfileMismatchesAsync(
  projectDir: string,
  lockfilePath: string,
  manager: string
): Promise<DependencyMismatch[]> {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (!(await fs.pathExists(packageJsonPath))) {
    return [];
  }

  const packageJson = await fs.readJson(packageJsonPath);
  const allDeps: Record<string, string> = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };

  const lockfileContent = await fs.readFile(lockfilePath, 'utf-8');
  const lockedVersions = parseLockfileVersions(lockfileContent, manager, lockfilePath);
  if (!lockedVersions) {
    return []; // Can't parse lockfile, skip check
  }

  const mismatches: DependencyMismatch[] = [];
  for (const [name, specifier] of Object.entries(allDeps)) {
    if (isNonRegistrySpecifier(specifier)) {
      continue;
    }

    const lockedVersion = lockedVersions.get(name);
    if (!lockedVersion) {
      continue; // Package not found in lockfile — may be a new dep or hoisted differently
    }

    if (!semver.satisfies(lockedVersion, specifier)) {
      mismatches.push({ name, specifier, lockedVersion });
    }
  }

  return mismatches;
}

/**
 * Pre-flight lockfile validation for `eas build`. Catches common lockfile
 * problems before uploading to the builder.
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
      'Run your package manager\'s install command (e.g. "npm install") to generate one, then commit it to version control.'
    );
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
    process.exit(1);
    return;
  }

  // --- 4. Lockfile out of sync ---
  // For bun, prefer the text lockfile for parsing (bun.lockb is binary)
  const parsableLockfilePath =
    requiredPackageManager === 'bun'
      ? (await findLockfileAsync(projectDir, BUN_TEXT_LOCK_FILE)) ?? lockfilePath
      : lockfilePath;

  const mismatches = await findLockfileMismatchesAsync(
    projectDir,
    parsableLockfilePath,
    requiredPackageManager
  );

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
    process.exit(1);
    return;
  }
}
