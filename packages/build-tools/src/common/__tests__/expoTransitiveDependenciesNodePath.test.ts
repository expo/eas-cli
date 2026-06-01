import { Env } from '@expo/eas-build-job';
import path from 'path';
import resolveFrom from 'resolve-from';

import { createMockLogger } from '../../__tests__/utils/logger';
import { configureExpoTransitiveDependenciesNodePathAsync } from '../expoTransitiveDependenciesNodePath';

jest.mock('resolve-from', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    silent: jest.fn(),
  }),
}));

const mockedResolveFrom = resolveFrom as jest.MockedFunction<typeof resolveFrom> & {
  silent: jest.MockedFunction<typeof resolveFrom.silent>;
};

describe(configureExpoTransitiveDependenciesNodePathAsync, () => {
  beforeEach(() => {
    mockedResolveFrom.silent.mockReset();
  });

  it('extends NODE_PATH with Expo transitive dependency locations', async () => {
    const projectDir = '/workingdir/build/apps/app';
    const packagerDir = '/workingdir/build';
    const expoPackageDir = '/workingdir/build/node_modules/.pnpm/expo@52/node_modules/expo';
    const expoNodeModulesDir = path.join(expoPackageDir, 'node_modules');
    const env: Env = { NODE_PATH: '/custom/node_modules' };
    const logger = createMockLogger();

    mockResolveFrom({
      [resolutionKey(projectDir, 'expo/package.json')]: path.join(expoPackageDir, 'package.json'),
      [resolutionKey(expoPackageDir, 'babel-preset-expo/package.json')]: path.join(
        expoNodeModulesDir,
        'babel-preset-expo',
        'package.json'
      ),
      [resolutionKey(expoPackageDir, 'expo-asset/package.json')]: path.join(
        expoNodeModulesDir,
        'expo-asset',
        'package.json'
      ),
    });

    await configureExpoTransitiveDependenciesNodePathAsync({
      projectDir,
      packagerDir,
      env,
      logger,
    });

    expect(env.NODE_PATH).toBe(['/custom/node_modules', expoNodeModulesDir].join(path.delimiter));
    expect(logger.info).toHaveBeenCalledWith(
      `Extending NODE_PATH with Expo dependency paths: ${expoNodeModulesDir}`
    );
  });

  it('does not update NODE_PATH when expo is not installed', async () => {
    const env: Env = { NODE_PATH: '/custom/node_modules' };
    const logger = createMockLogger();

    await configureExpoTransitiveDependenciesNodePathAsync({
      projectDir: '/workingdir/build',
      packagerDir: '/workingdir/build',
      env,
      logger,
    });

    expect(env.NODE_PATH).toBe('/custom/node_modules');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not update NODE_PATH when transitive dependencies already resolve from the project', async () => {
    const projectDir = '/workingdir/build';
    const expoPackageDir = '/workingdir/build/node_modules/expo';
    const env: Env = {};
    const logger = createMockLogger();

    mockResolveFrom({
      [resolutionKey(projectDir, 'expo/package.json')]: path.join(expoPackageDir, 'package.json'),
      [resolutionKey(projectDir, 'babel-preset-expo/package.json')]:
        '/workingdir/build/node_modules/babel-preset-expo/package.json',
      [resolutionKey(projectDir, 'expo-asset/package.json')]:
        '/workingdir/build/node_modules/expo-asset/package.json',
    });

    await configureExpoTransitiveDependenciesNodePathAsync({
      projectDir,
      packagerDir: projectDir,
      env,
      logger,
    });

    expect(env.NODE_PATH).toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('skips transitive dependencies that do not resolve from expo', async () => {
    const projectDir = '/workingdir/build';
    const expoPackageDir = '/workingdir/build/node_modules/.pnpm/expo@52/node_modules/expo';
    const expoNodeModulesDir = path.join(expoPackageDir, 'node_modules');
    const env: Env = {};
    const logger = createMockLogger();

    mockResolveFrom({
      [resolutionKey(projectDir, 'expo/package.json')]: path.join(expoPackageDir, 'package.json'),
      [resolutionKey(expoPackageDir, 'babel-preset-expo/package.json')]: path.join(
        expoNodeModulesDir,
        'babel-preset-expo',
        'package.json'
      ),
    });

    await configureExpoTransitiveDependenciesNodePathAsync({
      projectDir,
      packagerDir: projectDir,
      env,
      logger,
    });

    expect(env.NODE_PATH).toBe(expoNodeModulesDir);
  });

  it('does not duplicate existing NODE_PATH entries', async () => {
    const projectDir = '/workingdir/build';
    const expoPackageDir = '/workingdir/build/node_modules/.pnpm/expo@52/node_modules/expo';
    const expoNodeModulesDir = path.join(expoPackageDir, 'node_modules');
    const env: Env = { NODE_PATH: expoNodeModulesDir };
    const logger = createMockLogger();

    mockResolveFrom({
      [resolutionKey(projectDir, 'expo/package.json')]: path.join(expoPackageDir, 'package.json'),
      [resolutionKey(expoPackageDir, 'babel-preset-expo/package.json')]: path.join(
        expoNodeModulesDir,
        'babel-preset-expo',
        'package.json'
      ),
      [resolutionKey(expoPackageDir, 'expo-asset/package.json')]: path.join(
        expoNodeModulesDir,
        'expo-asset',
        'package.json'
      ),
    });

    await configureExpoTransitiveDependenciesNodePathAsync({
      projectDir,
      packagerDir: projectDir,
      env,
      logger,
    });

    expect(env.NODE_PATH).toBe(expoNodeModulesDir);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

function mockResolveFrom(resolutions: Record<string, string>): void {
  mockedResolveFrom.silent.mockImplementation((fromDir, moduleId) => {
    return resolutions[resolutionKey(fromDir, moduleId)];
  });
}

function resolutionKey(fromDir: string, moduleId: string): string {
  return `${fromDir}:${moduleId}`;
}
