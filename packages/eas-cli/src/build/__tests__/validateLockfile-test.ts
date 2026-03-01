import { Platform } from '@expo/eas-build-job';
import { ExitError } from '@oclif/core/lib/errors';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { CommonContext } from '../context';
import { checkLockfileAsync } from '../validateLockfile';
import { Client } from '../../vcs/vcs';

jest.mock('fs');
jest.mock('@expo/package-manager', () => ({
  NPM_LOCK_FILE: 'package-lock.json',
  YARN_LOCK_FILE: 'yarn.lock',
  PNPM_LOCK_FILE: 'pnpm-lock.yaml',
  BUN_LOCK_FILE: 'bun.lockb',
  BUN_TEXT_LOCK_FILE: 'bun.lock',
  resolveWorkspaceRoot: jest.fn(() => null),
}));

const { resolveWorkspaceRoot } = jest.requireMock<{
  resolveWorkspaceRoot: jest.Mock;
}>('@expo/package-manager');

function createMockContext(
  overrides: Partial<{
    projectDir: string;
    requiredPackageManager: string | null;
    isFileIgnoredAsync: (filePath: string) => Promise<boolean>;
    getRootPathAsync: () => Promise<string>;
  }> = {}
): CommonContext<Platform> {
  const vcsClient = {
    isFileIgnoredAsync: overrides.isFileIgnoredAsync ?? (async () => false),
    getRootPathAsync: overrides.getRootPathAsync ?? (async () => '/project'),
  } as unknown as Client;

  return {
    projectDir: overrides.projectDir ?? '/project',
    requiredPackageManager: overrides.requiredPackageManager ?? null,
    vcsClient,
  } as unknown as CommonContext<Platform>;
}

beforeEach(() => {
  vol.reset();
  resolveWorkspaceRoot.mockReturnValue(null);
});

describe(checkLockfileAsync, () => {
  it('errors when no package manager is detected', async () => {
    vol.fromJSON({ '/project/package.json': '{}' });
    const ctx = createMockContext({ requiredPackageManager: null });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow(ExitError);
  });

  it('errors when npm is detected but package-lock.json is missing', async () => {
    vol.fromJSON({ '/project/package.json': '{}' });
    const ctx = createMockContext({ requiredPackageManager: 'npm' });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow(ExitError);
  });

  it('does not error when lockfile exists and is tracked', async () => {
    vol.fromJSON({
      '/project/package.json': '{}',
      '/project/yarn.lock': '# yarn lockfile',
    });
    // Make lockfile newer than package.json
    const now = Date.now();
    fs.utimesSync('/project/package.json', new Date(now - 1000), new Date(now - 1000));
    fs.utimesSync('/project/yarn.lock', new Date(now), new Date(now));

    const ctx = createMockContext({ requiredPackageManager: 'yarn' });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
  });

  it('errors when lockfile exists but is gitignored', async () => {
    vol.fromJSON({
      '/project/package.json': '{}',
      '/project/yarn.lock': '# yarn lockfile',
    });
    const ctx = createMockContext({
      requiredPackageManager: 'yarn',
      isFileIgnoredAsync: async () => true,
    });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow(ExitError);
  });

  it('errors when conflicting lockfiles from multiple managers exist', async () => {
    vol.fromJSON({
      '/project/package.json': '{}',
      '/project/package-lock.json': '{}',
      '/project/yarn.lock': '# yarn lockfile',
    });
    // Make lockfile newer than package.json
    const now = Date.now();
    fs.utimesSync('/project/package.json', new Date(now - 1000), new Date(now - 1000));
    fs.utimesSync('/project/package-lock.json', new Date(now), new Date(now));

    const ctx = createMockContext({ requiredPackageManager: 'npm' });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow(ExitError);
  });

  it('warns but does not error when package.json is newer than lockfile', async () => {
    vol.fromJSON({
      '/project/yarn.lock': '# yarn lockfile',
      '/project/package.json': '{}',
    });
    // Make package.json newer than lockfile
    const now = Date.now();
    fs.utimesSync('/project/yarn.lock', new Date(now - 2000), new Date(now - 2000));
    fs.utimesSync('/project/package.json', new Date(now), new Date(now));

    const ctx = createMockContext({ requiredPackageManager: 'yarn' });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
  });

  it('finds lockfile at workspace root for monorepos', async () => {
    vol.fromJSON({
      '/monorepo/yarn.lock': '# yarn lockfile',
      '/monorepo/packages/app/package.json': '{}',
    });
    resolveWorkspaceRoot.mockReturnValue('/monorepo');

    // Make lockfile newer than package.json
    const now = Date.now();
    fs.utimesSync(
      '/monorepo/packages/app/package.json',
      new Date(now - 1000),
      new Date(now - 1000)
    );
    fs.utimesSync('/monorepo/yarn.lock', new Date(now), new Date(now));

    const ctx = createMockContext({
      projectDir: '/monorepo/packages/app',
      requiredPackageManager: 'yarn',
      getRootPathAsync: async () => '/monorepo',
    });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
  });

  it('does not report a conflict when both bun.lock and bun.lockb are present', async () => {
    vol.fromJSON({
      '/project/package.json': '{}',
      '/project/bun.lockb': 'binary',
      '/project/bun.lock': '# bun text lockfile',
    });
    // Make lockfile newer than package.json
    const now = Date.now();
    fs.utimesSync('/project/package.json', new Date(now - 1000), new Date(now - 1000));
    fs.utimesSync('/project/bun.lockb', new Date(now), new Date(now));
    fs.utimesSync('/project/bun.lock', new Date(now), new Date(now));

    const ctx = createMockContext({ requiredPackageManager: 'bun' });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
  });
});
