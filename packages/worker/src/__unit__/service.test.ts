import {
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  Platform,
  Workflow,
  errors,
} from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';

import { build } from '../build';
import { createBuildContext } from '../context';
import BuildService, { getExpoPackageVersionAsync } from '../service';
import { turtleFetch } from '../utils/turtleFetch';

jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => jest.fn());
jest.mock('../build', () => ({
  build: jest.fn(),
}));
jest.mock('../context', () => ({
  createBuildContext: jest.fn(),
}));
jest.mock('../external/analytics', () => ({
  Analytics: jest.fn().mockImplementation(() => ({
    flushEventsAsync: jest.fn(),
    logEvent: jest.fn(),
  })),
}));
jest.mock('../logger', () => {
  const logger = {
    child: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    level: jest.fn(),
    warn: jest.fn(),
  };
  logger.child.mockReturnValue(logger);

  return {
    __esModule: true,
    default: logger,
    createBuildLoggerWithSecretsFilter: jest.fn(async () => ({
      cleanUp: jest.fn(),
      logBuffer: { getLogs: jest.fn(() => []), getPhaseLogs: jest.fn(() => []) },
      logger,
    })),
  };
});
jest.mock('../sentry', () => ({
  __esModule: true,
  default: {
    capture: jest.fn(),
  },
}));
jest.mock('../utils/turtleFetch', () => ({
  turtleFetch: jest.fn(),
}));
jest.mock('../config', () => {
  const config = jest.requireActual('../config').default;
  return {
    __esModule: true,
    default: {
      ...config,
      buildId: 'build-id',
      wwwApiV2BaseUrl: 'http://api.expo.test/v2/',
    },
  };
});

describe(getExpoPackageVersionAsync, () => {
  const projectRoot = '/test-project';
  const expoPackageJsonPath = path.join(projectRoot, 'node_modules/expo/package.json');
  const buildContext = {
    env: { PATH: '/usr/bin' },
    getReactNativeProjectDirectory: () => projectRoot,
  } as any;

  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();
  });

  it('returns the exact installed expo package version', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: Buffer.from(expoPackageJsonPath) } as any);
    vol.fromJSON({
      [expoPackageJsonPath]: JSON.stringify({ version: '55.0.17' }),
    });

    await expect(getExpoPackageVersionAsync(buildContext)).resolves.toBe('55.0.17');
    expect(spawn).toHaveBeenCalledWith(
      'node',
      ['--print', "require.resolve('expo/package.json')"],
      expect.objectContaining({
        cwd: projectRoot,
        env: buildContext.env,
      })
    );
  });

  it('throws a user error when expo package version resolution fails', async () => {
    jest.mocked(spawn).mockRejectedValue(new Error('Cannot find module expo/package.json'));

    await expect(getExpoPackageVersionAsync(buildContext)).rejects.toMatchObject({
      errorCode: 'EAS_BUILD_EXPO_PACKAGE_VERSION_NOT_FOUND',
    });
    await expect(getExpoPackageVersionAsync(buildContext)).rejects.toBeInstanceOf(errors.UserError);
  });

  it('throws a user error when the installed expo package version is not valid semver', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: Buffer.from(expoPackageJsonPath) } as any);
    vol.fromJSON({
      [expoPackageJsonPath]: JSON.stringify({ version: 'invalid-version' }),
    });

    await expect(getExpoPackageVersionAsync(buildContext)).rejects.toMatchObject({
      errorCode: 'EAS_BUILD_EXPO_PACKAGE_VERSION_INVALID',
    });
    await expect(getExpoPackageVersionAsync(buildContext)).rejects.toBeInstanceOf(errors.UserError);
  });
});

