import { Platform } from '@expo/eas-build-job';
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

const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

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

const PACKAGE_JSON_WITH_REACT = JSON.stringify({
  dependencies: { react: '19.0.4', 'react-native': '~0.79.0' },
});

const NPM_LOCKFILE_SYNCED = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    'node_modules/react': { version: '19.0.4' },
    'node_modules/react-native': { version: '0.79.4' },
  },
});

const NPM_LOCKFILE_STALE = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    'node_modules/react': { version: '19.0.0' },
    'node_modules/react-native': { version: '0.79.4' },
  },
});

// bun.lock uses JSONC with trailing commas
const BUN_LOCKFILE_STALE = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "dependencies": {
        "react": "19.0.4",
      },
    },
  },
  "packages": {
    "react": ["react@19.0.0", "", {}, "sha512-abc"],
  },
}`;

const BUN_LOCKFILE_SYNCED = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "dependencies": {
        "react": "19.0.4",
      },
    },
  },
  "packages": {
    "react": ["react@19.0.4", "", {}, "sha512-abc"],
  },
}`;

const YARN_LOCKFILE_STALE = `# yarn lockfile v1

react@19.0.4:
  version "19.0.0"
  resolved "https://registry.yarnpkg.com/react/-/react-19.0.0.tgz"
`;

const YARN_LOCKFILE_SYNCED = `# yarn lockfile v1

react@19.0.4:
  version "19.0.4"
  resolved "https://registry.yarnpkg.com/react/-/react-19.0.4.tgz"

react-native@~0.79.0:
  version "0.79.4"
  resolved "https://registry.yarnpkg.com/react-native/-/react-native-0.79.4.tgz"
`;

beforeEach(() => {
  vol.reset();
  resolveWorkspaceRoot.mockReturnValue(null);
  mockProcessExit.mockClear();
});

describe(checkLockfileAsync, () => {
  it('exits when no package manager is detected', async () => {
    vol.fromJSON({ '/project/package.json': '{}' });
    const ctx = createMockContext({ requiredPackageManager: null });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('exits when npm is detected but package-lock.json is missing', async () => {
    vol.fromJSON({ '/project/package.json': '{}' });
    const ctx = createMockContext({ requiredPackageManager: 'npm' });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('does not error when lockfile exists and is in sync', async () => {
    vol.fromJSON({
      '/project/package.json': PACKAGE_JSON_WITH_REACT,
      '/project/package-lock.json': NPM_LOCKFILE_SYNCED,
    });
    const ctx = createMockContext({ requiredPackageManager: 'npm' });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it('exits when lockfile exists but is gitignored', async () => {
    vol.fromJSON({
      '/project/package.json': '{}',
      '/project/yarn.lock': '# yarn lockfile',
    });
    const ctx = createMockContext({
      requiredPackageManager: 'yarn',
      isFileIgnoredAsync: async () => true,
    });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('exits when conflicting lockfiles from multiple managers exist', async () => {
    vol.fromJSON({
      '/project/package.json': '{}',
      '/project/package-lock.json': NPM_LOCKFILE_SYNCED,
      '/project/yarn.lock': '# yarn lockfile',
    });
    const ctx = createMockContext({ requiredPackageManager: 'npm' });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('exits when npm lockfile version does not satisfy package.json specifier', async () => {
    vol.fromJSON({
      '/project/package.json': PACKAGE_JSON_WITH_REACT,
      '/project/package-lock.json': NPM_LOCKFILE_STALE,
    });
    const ctx = createMockContext({ requiredPackageManager: 'npm' });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('exits when bun.lock version does not satisfy package.json specifier', async () => {
    vol.fromJSON({
      '/project/package.json': JSON.stringify({ dependencies: { react: '19.0.4' } }),
      '/project/bun.lock': BUN_LOCKFILE_STALE,
    });
    const ctx = createMockContext({ requiredPackageManager: 'bun' });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('does not error when bun.lock is in sync', async () => {
    vol.fromJSON({
      '/project/package.json': JSON.stringify({ dependencies: { react: '19.0.4' } }),
      '/project/bun.lock': BUN_LOCKFILE_SYNCED,
    });
    const ctx = createMockContext({ requiredPackageManager: 'bun' });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it('exits when yarn lockfile version does not satisfy package.json specifier', async () => {
    vol.fromJSON({
      '/project/package.json': JSON.stringify({ dependencies: { react: '19.0.4' } }),
      '/project/yarn.lock': YARN_LOCKFILE_STALE,
    });
    const ctx = createMockContext({ requiredPackageManager: 'yarn' });
    await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('does not error when yarn lockfile is in sync', async () => {
    vol.fromJSON({
      '/project/package.json': PACKAGE_JSON_WITH_REACT,
      '/project/yarn.lock': YARN_LOCKFILE_SYNCED,
    });
    const ctx = createMockContext({ requiredPackageManager: 'yarn' });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it('finds lockfile at workspace root for monorepos', async () => {
    vol.fromJSON({
      '/monorepo/yarn.lock': YARN_LOCKFILE_SYNCED,
      '/monorepo/packages/app/package.json': PACKAGE_JSON_WITH_REACT,
    });
    resolveWorkspaceRoot.mockReturnValue('/monorepo');

    const ctx = createMockContext({
      projectDir: '/monorepo/packages/app',
      requiredPackageManager: 'yarn',
      getRootPathAsync: async () => '/monorepo',
    });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it('does not report a conflict when both bun.lock and bun.lockb are present', async () => {
    vol.fromJSON({
      '/project/package.json': JSON.stringify({ dependencies: { react: '19.0.4' } }),
      '/project/bun.lockb': 'binary',
      '/project/bun.lock': BUN_LOCKFILE_SYNCED,
    });
    const ctx = createMockContext({ requiredPackageManager: 'bun' });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it('skips sync check for non-registry specifiers', async () => {
    vol.fromJSON({
      '/project/package.json': JSON.stringify({
        dependencies: {
          'my-local-pkg': 'file:../local',
          'my-workspace-pkg': 'workspace:*',
          react: '19.0.4',
        },
      }),
      '/project/package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/react': { version: '19.0.4' },
        },
      }),
    });
    const ctx = createMockContext({ requiredPackageManager: 'npm' });
    await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  describe('peer dependency conflicts', () => {
    it('exits when a direct dependency has an unsatisfied peer (npm)', async () => {
      vol.fromJSON({
        '/project/package.json': JSON.stringify({
          dependencies: { react: '19.0.0', 'react-dom': '19.2.4' },
        }),
        '/project/package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/react': { version: '19.0.0' },
            'node_modules/react-dom': {
              version: '19.2.4',
              peerDependencies: { react: '^19.2.4' },
            },
          },
        }),
      });
      const ctx = createMockContext({ requiredPackageManager: 'npm' });
      await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('exits when a direct dependency has an unsatisfied peer (bun)', async () => {
      vol.fromJSON({
        '/project/package.json': JSON.stringify({
          dependencies: { react: '19.0.0', 'react-dom': '19.2.4' },
        }),
        '/project/bun.lock': `{
          "lockfileVersion": 1,
          "workspaces": { "": { "dependencies": { "react": "19.0.0", "react-dom": "19.2.4" } } },
          "packages": {
            "react": ["react@19.0.0", "", {}, "sha512-abc"],
            "react-dom": ["react-dom@19.2.4", "", { "peerDependencies": { "react": "^19.2.4" } }, "sha512-def"],
          },
        }`,
      });
      const ctx = createMockContext({ requiredPackageManager: 'bun' });
      await expect(checkLockfileAsync(ctx)).rejects.toThrow('process.exit called');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('does not error when peer dependencies are satisfied', async () => {
      vol.fromJSON({
        '/project/package.json': JSON.stringify({
          dependencies: { react: '19.2.4', 'react-dom': '19.2.4' },
        }),
        '/project/package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/react': { version: '19.2.4' },
            'node_modules/react-dom': {
              version: '19.2.4',
              peerDependencies: { react: '^19.2.4' },
            },
          },
        }),
      });
      const ctx = createMockContext({ requiredPackageManager: 'npm' });
      await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('skips optional peer dependencies (npm peerDependenciesMeta)', async () => {
      vol.fromJSON({
        '/project/package.json': JSON.stringify({
          dependencies: { '@0no-co/graphql.web': '1.2.0' },
        }),
        '/project/package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/@0no-co/graphql.web': {
              version: '1.2.0',
              peerDependencies: { graphql: '^14.0.0 || ^15.0.0 || ^16.0.0' },
              peerDependenciesMeta: { graphql: { optional: true } },
            },
          },
        }),
      });
      const ctx = createMockContext({ requiredPackageManager: 'npm' });
      await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('skips optional peer dependencies (bun optionalPeers)', async () => {
      vol.fromJSON({
        '/project/package.json': JSON.stringify({
          dependencies: { '@0no-co/graphql.web': '1.2.0' },
        }),
        '/project/bun.lock': `{
          "lockfileVersion": 1,
          "workspaces": { "": { "dependencies": { "@0no-co/graphql.web": "1.2.0" } } },
          "packages": {
            "@0no-co/graphql.web": ["@0no-co/graphql.web@1.2.0", "", { "peerDependencies": { "graphql": "^14.0.0 || ^15.0.0 || ^16.0.0" }, "optionalPeers": ["graphql"] }, "sha512-abc"],
          },
        }`,
      });
      const ctx = createMockContext({ requiredPackageManager: 'bun' });
      await expect(checkLockfileAsync(ctx)).resolves.not.toThrow();
      expect(mockProcessExit).not.toHaveBeenCalled();
    });
  });
});
