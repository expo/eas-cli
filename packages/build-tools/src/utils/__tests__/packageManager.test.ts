import { errors } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';
import semver from 'semver';

import {
  PackageManager,
  findPackagerRootDir,
  getPackageVersionFromPackageJson,
  resolvePackageManager,
  resolvePackageVersionAsync,
  shouldUseFrozenLockfile,
} from '../packageManager';

jest.mock('fs');

const rootDir = '/working/dir';

describe(resolvePackageManager, () => {
  beforeEach(async () => {
    vol.reset();
    await fs.mkdirp(rootDir);
  });

  it('returns yarn when no lockfiles exist', async () => {
    expect(resolvePackageManager(rootDir, { env: {} })).toBe('yarn');
  });

  it('returns npm when only package-json.lock exist', async () => {
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), 'content');
    expect(resolvePackageManager(rootDir, { env: {} })).toBe('npm');
  });

  it('returns yarn when only yarn.lock exists', async () => {
    await fs.writeFile(path.join(rootDir, 'yarn.lock'), 'content');
    expect(resolvePackageManager(rootDir, { env: {} })).toBe('yarn');
  });

  it('returns yarn when both lockfiles exists', async () => {
    await fs.writeFile(path.join(rootDir, 'yarn.lock'), 'content');
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), 'content');
    expect(resolvePackageManager(rootDir, { env: {} })).toBe('yarn');
  });

  it('returns npm within a monorepo', async () => {
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), 'content');
    await fs.writeJson(path.join(rootDir, 'package.json'), {
      name: 'monorepo',
      workspaces: ['packages/*'],
    });

    const nestedDir = path.join(rootDir, 'packages', 'expo-app');
    await fs.mkdirp(nestedDir);
    await fs.writeJson(path.join(nestedDir, 'package.json'), {
      name: '@monorepo/expo-app',
    });

    expect(resolvePackageManager(nestedDir, { env: {} })).toBe('npm');
  });

  it('returns yarn with an invalid monorepo', async () => {
    // this shouldn't be picked up, because our package.json doesn't define the workspace
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), 'content');
    await fs.writeFile(path.join(rootDir, 'package.json'), 'invalidjson');

    const nestedDir = path.join(rootDir, 'packages', 'expo-app');
    await fs.mkdirp(nestedDir);
    await fs.writeFile(path.join(nestedDir, 'package.json'), 'content');

    expect(resolvePackageManager(nestedDir, { env: {} })).toBe('yarn');
  });

  it('returns yarn when no lockfile and env var is an empty string', () => {
    expect(
      resolvePackageManager(rootDir, {
        env: { EAS_FALLBACK_PACKAGE_MANAGER: '' },
      })
    ).toBe(PackageManager.YARN);
  });

  it('returns bun from EAS_FALLBACK_PACKAGE_MANAGER when no lockfile', () => {
    expect(resolvePackageManager(rootDir, { env: { EAS_FALLBACK_PACKAGE_MANAGER: 'bun' } })).toBe(
      PackageManager.BUN
    );
  });

  it('returns pnpm from EAS_FALLBACK_PACKAGE_MANAGER when no lockfile', () => {
    expect(resolvePackageManager(rootDir, { env: { EAS_FALLBACK_PACKAGE_MANAGER: 'pnpm' } })).toBe(
      PackageManager.PNPM
    );
  });

  it('ignores EAS_FALLBACK_PACKAGE_MANAGER when a lockfile exists', async () => {
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), 'content');
    expect(
      resolvePackageManager(rootDir, {
        env: { EAS_FALLBACK_PACKAGE_MANAGER: 'bunn' }, // invalid, but should not even be read
      })
    ).toBe(PackageManager.NPM);
  });

  it('throws a UserError on unsupported EAS_FALLBACK_PACKAGE_MANAGER value', () => {
    expect(() =>
      resolvePackageManager(rootDir, { env: { EAS_FALLBACK_PACKAGE_MANAGER: 'bunn' } })
    ).toThrow(errors.UserError);
    try {
      resolvePackageManager(rootDir, { env: { EAS_FALLBACK_PACKAGE_MANAGER: 'bunn' } });
    } catch (e) {
      expect(e).toBeInstanceOf(errors.UserError);
      const error = e as errors.UserError;
      expect(error.errorCode).toBe('EAS_INVALID_FALLBACK_PACKAGE_MANAGER');
      expect(error.message).toContain('bunn');
      expect(error.message).toContain('yarn, npm, pnpm, bun');
    }
  });
});

describe(resolvePackageVersionAsync, () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as bunyan;

  it('should resolve version from package name and dist tag', async () => {
    const version = await resolvePackageVersionAsync({
      logger,
      packageName: '@expo/repack-app',
      distTag: 'latest',
    });
    expect(semver.valid(version)).toBeTruthy();
  });

  it('should return null if version cannot be resolved', async () => {
    const version = await resolvePackageVersionAsync({
      logger,
      packageName: '@expo/repack-app',
      distTag: 'nonexistent-dist-tag',
    });
    expect(version).toBeNull();
  });
});

describe(findPackagerRootDir, () => {
  beforeEach(() => {
    vol.reset();
  });

  it('returns the workspace root if the current dir is a workspace', async () => {
    vol.fromJSON(
      {
        './package.json': JSON.stringify({
          workspaces: ['some-package', 'react-native-project'],
        }),
        './some-package/package.json': JSON.stringify({
          name: 'some-package',
        }),
        './react-native-project/package.json': JSON.stringify({
          name: 'react-native-project',
        }),
      },
      '/repo'
    );

    const rootDir = findPackagerRootDir('/repo/react-native-project');
    expect(rootDir).toBe('/repo');
  });

  it(
    `returns the current dir if it's not a workspace` +
      ` (package.json exists in root dir and contains workspaces field)`,
    async () => {
      vol.fromJSON(
        {
          './package.json': JSON.stringify({
            workspaces: ['some-package'],
          }),
          './some-package/package.json': JSON.stringify({
            name: 'some-package',
          }),
          './react-native-project/package.json': JSON.stringify({
            name: 'react-native-project',
          }),
        },
        '/repo'
      );

      const rootDir = findPackagerRootDir('/repo/react-native-project');
      expect(rootDir).toBe('/repo/react-native-project');
    }
  );

  it(
    `returns the current dir if it's not a workspace` +
      ` (package.json exists in root dir and does not contain workspaces field)`,
    async () => {
      vol.fromJSON(
        {
          './package.json': JSON.stringify({}),
          './some-package/package.json': JSON.stringify({
            name: 'some-package',
          }),
          './react-native-project/package.json': JSON.stringify({
            name: 'react-native-project',
          }),
        },
        '/repo'
      );

      const rootDir = findPackagerRootDir('/repo/react-native-project');
      expect(rootDir).toBe('/repo/react-native-project');
    }
  );

  it(`returns the current dir if it's not a workspace (package.json does not exist in root dir) `, async () => {
    vol.fromJSON(
      {
        './some-package/package.json': JSON.stringify({
          name: 'some-package',
        }),
        './react-native-project/package.json': JSON.stringify({
          name: 'react-native-project',
        }),
      },
      '/repo'
    );

    const rootDir = findPackagerRootDir('/repo/react-native-project');
    expect(rootDir).toBe('/repo/react-native-project');
  });
});

describe(getPackageVersionFromPackageJson, () => {
  const CASES = [
    [
      {
        dependencies: {
          'react-native': '0.79.0',
        },
      },
      'react-native',
      '0.79.0',
    ],
    [
      {
        dependencies: {
          expo: '52.0.0',
          'react-native': '0.79.0',
        },
      },
      'expo',
      '52.0.0',
    ],
    [
      {
        dependencies: {
          'react-native': '~0.79.0',
        },
      },
      'react-native',
      '0.79.0',
    ],
    [null, 'react-native', undefined],
    ['not-a-package-json', 'react-native', undefined],
    [42, 'react-native', undefined],
  ] as const;

  for (const [packageJson, packageName, expectedVersion] of CASES) {
    it(`returns the version of the package ${packageName}`, () => {
      expect(getPackageVersionFromPackageJson({ packageJson, packageName })).toBe(expectedVersion);
    });
  }
});

describe(shouldUseFrozenLockfile, () => {
  it('works', () => {
    expect(
      shouldUseFrozenLockfile({
        env: {},
        sdkVersion: '52.0.0',
        reactNativeVersion: '0.79.0',
      })
    ).toBe(false);

    expect(
      shouldUseFrozenLockfile({
        env: {},
        sdkVersion: '53.0.0',
        reactNativeVersion: '0.79.0',
      })
    ).toBe(true);

    expect(
      shouldUseFrozenLockfile({
        env: {
          EAS_NO_FROZEN_LOCKFILE: '1',
        },
        sdkVersion: '53.0.0',
        reactNativeVersion: '0.79.0',
      })
    ).toBe(false);
  });
});
