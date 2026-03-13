import { findLockfileMismatches, findPeerDependencyConflicts } from '../validators';
import { LockfileData, PackageInfo } from '../types';

function makeLockfileData(packages: Record<string, PackageInfo>): LockfileData {
  return { packages: new Map(Object.entries(packages)) };
}

describe('findLockfileMismatches', () => {
  it('returns empty when lockfile is in sync', () => {
    const packageJson = { dependencies: { react: '19.0.4', 'react-native': '~0.79.0' } };
    const lockfile = makeLockfileData({
      react: { version: '19.0.4' },
      'react-native': { version: '0.79.4' },
    });
    expect(findLockfileMismatches(packageJson, lockfile)).toEqual([]);
  });

  it('detects version mismatch', () => {
    const packageJson = { dependencies: { react: '19.0.4' } };
    const lockfile = makeLockfileData({ react: { version: '19.0.0' } });
    const mismatches = findLockfileMismatches(packageJson, lockfile);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toEqual({
      name: 'react',
      specifier: '19.0.4',
      lockedVersion: '19.0.0',
    });
  });

  it('checks devDependencies and optionalDependencies', () => {
    const packageJson = {
      devDependencies: { typescript: '^5.5.0' },
      optionalDependencies: { fsevents: '^2.3.0' },
    };
    const lockfile = makeLockfileData({
      typescript: { version: '5.5.4' },
      fsevents: { version: '2.3.3' },
    });
    expect(findLockfileMismatches(packageJson, lockfile)).toEqual([]);
  });

  it('skips non-registry specifiers', () => {
    const packageJson = {
      dependencies: {
        'my-local': 'file:../local',
        'my-workspace': 'workspace:*',
        'my-git': 'git+https://github.com/foo/bar.git',
        'my-github': 'github:foo/bar',
        'my-latest': 'latest',
      },
    };
    const lockfile = makeLockfileData({});
    expect(findLockfileMismatches(packageJson, lockfile)).toEqual([]);
  });

  it('skips packages not found in lockfile', () => {
    const packageJson = { dependencies: { 'new-dep': '^1.0.0' } };
    const lockfile = makeLockfileData({});
    expect(findLockfileMismatches(packageJson, lockfile)).toEqual([]);
  });
});

describe('findPeerDependencyConflicts', () => {
  it('returns empty when peers are satisfied', () => {
    const packageJson = { dependencies: { react: '19.2.4', 'react-dom': '19.2.4' } };
    const lockfile = makeLockfileData({
      react: { version: '19.2.4' },
      'react-dom': {
        version: '19.2.4',
        peerDependencies: { react: '^19.2.4' },
      },
    });
    expect(findPeerDependencyConflicts(packageJson, lockfile)).toEqual([]);
  });

  it('detects unsatisfied peer dependency', () => {
    const packageJson = { dependencies: { react: '19.0.0', 'react-dom': '19.2.4' } };
    const lockfile = makeLockfileData({
      react: { version: '19.0.0' },
      'react-dom': {
        version: '19.2.4',
        peerDependencies: { react: '^19.2.4' },
      },
    });
    const conflicts = findPeerDependencyConflicts(packageJson, lockfile);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      source: 'react-dom',
      sourceVersion: '19.2.4',
      peer: 'react',
      peerRange: '^19.2.4',
      installedVersion: '19.0.0',
    });
  });

  it('skips optional peers', () => {
    const packageJson = { dependencies: { '@0no-co/graphql.web': '1.2.0' } };
    const lockfile = makeLockfileData({
      '@0no-co/graphql.web': {
        version: '1.2.0',
        peerDependencies: { graphql: '^14.0.0 || ^15.0.0 || ^16.0.0' },
        optionalPeers: new Set(['graphql']),
      },
    });
    expect(findPeerDependencyConflicts(packageJson, lockfile)).toEqual([]);
  });

  it('skips peers not installed in lockfile', () => {
    const packageJson = { dependencies: { 'react-dom': '19.2.4' } };
    const lockfile = makeLockfileData({
      'react-dom': {
        version: '19.2.4',
        peerDependencies: { react: '^19.2.4' },
      },
    });
    expect(findPeerDependencyConflicts(packageJson, lockfile)).toEqual([]);
  });
});
