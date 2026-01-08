import path from 'path';

import { vol } from 'memfs';
import fs from 'fs-extra';

import {
  resolvePackageManager,
  findPackagerRootDir,
  getPackageVersionFromPackageJson,
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
    expect(resolvePackageManager(rootDir)).toBe('yarn');
  });

  it('returns npm when only package-json.lock exist', async () => {
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), 'content');
    expect(resolvePackageManager(rootDir)).toBe('npm');
  });

  it('returns yarn when only yarn.lock exists', async () => {
    await fs.writeFile(path.join(rootDir, 'yarn.lock'), 'content');
    expect(resolvePackageManager(rootDir)).toBe('yarn');
  });

  it('returns yarn when both lockfiles exists', async () => {
    await fs.writeFile(path.join(rootDir, 'yarn.lock'), 'content');
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), 'content');
    expect(resolvePackageManager(rootDir)).toBe('yarn');
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

    expect(resolvePackageManager(nestedDir)).toBe('npm');
  });

  it('returns yarn with an invalid monorepo', async () => {
    // this shouldn't be picked up, because our package.json doesn't define the workspace
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), 'content');
    await fs.writeFile(path.join(rootDir, 'package.json'), 'invalidjson');

    const nestedDir = path.join(rootDir, 'packages', 'expo-app');
    await fs.mkdirp(nestedDir);
    await fs.writeFile(path.join(nestedDir, 'package.json'), 'content');

    expect(resolvePackageManager(nestedDir)).toBe('yarn');
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
