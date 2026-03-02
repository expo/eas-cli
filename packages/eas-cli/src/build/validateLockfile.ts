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
// Each returns a LockfileData or null if parsing fails.
// Wrapped in try/catch so a parse failure silently skips checks.

interface PackageInfo {
  version: string;
  peerDependencies?: Record<string, string>;
  optionalPeers?: Set<string>;
}

interface LockfileData {
  packages: Map<string, PackageInfo>;
}

function parseNpmLock(content: string): LockfileData | null {
  try {
    const lockfile = JSON.parse(content);
    const rawPackages: Record<
      string,
      {
        version?: string;
        peerDependencies?: Record<string, string>;
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      }
    > = lockfile.packages ?? {};
    const packages = new Map<string, PackageInfo>();
    for (const [key, value] of Object.entries(rawPackages)) {
      if (!key.startsWith('node_modules/')) {
        continue;
      }
      const rest = key.slice('node_modules/'.length);
      // Skip nested node_modules (transitive deps)
      if (rest.includes('node_modules/')) {
        continue;
      }
      if (value.version) {
        const optionalPeers = new Set<string>();
        if (value.peerDependenciesMeta) {
          for (const [peer, meta] of Object.entries(value.peerDependenciesMeta)) {
            if (meta.optional) {
              optionalPeers.add(peer);
            }
          }
        }
        packages.set(rest, {
          version: value.version,
          peerDependencies: value.peerDependencies,
          optionalPeers: optionalPeers.size > 0 ? optionalPeers : undefined,
        });
      }
    }
    return { packages };
  } catch {
    return null;
  }
}

function parseYarnLock(content: string): LockfileData | null {
  try {
    const packages = new Map<string, PackageInfo>();
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
          if (!packages.has(currentPackage)) {
            packages.set(currentPackage, { version: versionMatch[1] });
          }
          currentPackage = null;
        }
      }
    }
    // yarn.lock doesn't include peer dependency info
    return { packages };
  } catch {
    return null;
  }
}

function parsePnpmLock(content: string): LockfileData | null {
  try {
    const packages = new Map<string, PackageInfo>();
    // Match entries in the packages section like:
    //   react@19.0.0:   or   @types/react@19.0.0:
    const packageRegex = /^ {2}((?:@[\w.-]+\/)?[\w.-]+)@(\d+[^:\s]*?):/gm;
    let match;
    while ((match = packageRegex.exec(content)) !== null) {
      if (!packages.has(match[1])) {
        packages.set(match[1], { version: match[2] });
      }
    }
    // pnpm-lock.yaml doesn't readily expose peer deps in a parseable way without YAML
    return { packages };
  } catch {
    return null;
  }
}

function parseBunLock(content: string): LockfileData | null {
  try {
    // bun.lock is JSONC (has trailing commas) — strip them for JSON.parse
    const jsonContent = content.replace(/,(\s*[}\]])/g, '$1');
    const lockfile = JSON.parse(jsonContent);
    const rawPackages: Record<string, unknown[]> = lockfile.packages ?? {};
    const packages = new Map<string, PackageInfo>();
    for (const [name, value] of Object.entries(rawPackages)) {
      // Format: "react": ["react@19.0.0", "", { peerDependencies: {...}, optionalPeers: [...] }, "sha512-..."]
      if (Array.isArray(value) && typeof value[0] === 'string') {
        const entry: string = value[0];
        const atIndex = entry.lastIndexOf('@');
        if (atIndex > 0) {
          const meta = (typeof value[2] === 'object' && value[2] !== null ? value[2] : {}) as {
            peerDependencies?: Record<string, string>;
            optionalPeers?: string[];
          };
          packages.set(name, {
            version: entry.slice(atIndex + 1),
            peerDependencies: meta.peerDependencies,
            optionalPeers: meta.optionalPeers ? new Set(meta.optionalPeers) : undefined,
          });
        }
      }
    }
    return { packages };
  } catch {
    return null;
  }
}

function parseLockfile(
  content: string,
  manager: string,
  lockfilePath: string
): LockfileData | null {
  switch (manager) {
    case 'npm':
      return parseNpmLock(content);
    case 'yarn':
      return parseYarnLock(content);
    case 'pnpm':
      return parsePnpmLock(content);
    case 'bun':
      // bun.lockb is binary — can only parse the text variant
      if (lockfilePath.endsWith('.lockb')) {
        return null;
      }
      return parseBunLock(content);
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

interface PeerDependencyConflict {
  /** Package that declares the peer dependency */
  source: string;
  sourceVersion: string;
  /** The peer dependency that is not satisfied */
  peer: string;
  peerRange: string;
  /** The actual version of the peer in the lockfile */
  installedVersion: string;
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

function findLockfileMismatches(
  packageJson: Record<string, unknown>,
  lockfileData: LockfileData
): DependencyMismatch[] {
  const allDeps: Record<string, string> = {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
    ...(packageJson.optionalDependencies as Record<string, string> | undefined),
  };

  const mismatches: DependencyMismatch[] = [];
  for (const [name, specifier] of Object.entries(allDeps)) {
    if (isNonRegistrySpecifier(specifier)) {
      continue;
    }

    const pkg = lockfileData.packages.get(name);
    if (!pkg) {
      continue; // Package not found in lockfile — may be a new dep or hoisted differently
    }

    if (!semver.satisfies(pkg.version, specifier)) {
      mismatches.push({ name, specifier, lockedVersion: pkg.version });
    }
  }

  return mismatches;
}

function findPeerDependencyConflicts(
  packageJson: Record<string, unknown>,
  lockfileData: LockfileData
): PeerDependencyConflict[] {
  // Check peer deps of direct dependencies only (most common source of build failures)
  const directDeps: Record<string, string> = {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
  };

  const conflicts: PeerDependencyConflict[] = [];
  for (const depName of Object.keys(directDeps)) {
    const pkg = lockfileData.packages.get(depName);
    if (!pkg?.peerDependencies) {
      continue;
    }

    for (const [peer, peerRange] of Object.entries(pkg.peerDependencies)) {
      // Skip optional peers
      if (pkg.optionalPeers?.has(peer)) {
        continue;
      }

      const peerPkg = lockfileData.packages.get(peer);
      if (!peerPkg) {
        continue; // Peer not installed — might be optional or provided by a parent
      }

      if (!semver.satisfies(peerPkg.version, peerRange)) {
        conflicts.push({
          source: depName,
          sourceVersion: pkg.version,
          peer,
          peerRange,
          installedVersion: peerPkg.version,
        });
      }
    }
  }

  return conflicts;
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
    process.exit(1);
    return;
  }
}
