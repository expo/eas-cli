import semver from 'semver';

import { DependencyMismatch, LockfileData, PeerDependencyConflict } from './types';

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

export function findLockfileMismatches(
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

export function findPeerDependencyConflicts(
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
