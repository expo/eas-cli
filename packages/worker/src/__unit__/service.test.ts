import {
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  Platform,
  Workflow,
  getInstalledExpoPackageVersionAsync as getInstalledExpoPackageVersionFromProjectAsync,
} from '@expo/eas-build-job';
import { vol } from 'memfs';

import { build } from '../build';
import { createBuildContext } from '../context';
import BuildService, { getInstalledExpoPackageVersionAsync } from '../service';
import { turtleFetch } from '../utils/turtleFetch';

jest.mock('fs');
jest.mock('@expo/eas-build-job', () => ({
  ...jest.requireActual('@expo/eas-build-job'),
  getInstalledExpoPackageVersionAsync: jest.fn(),
}));
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

describe(getInstalledExpoPackageVersionAsync, () => {
  const projectRoot = '/test-project';
  const buildContext = {
    env: { PATH: '/usr/bin' },
    getReactNativeProjectDirectory: () => projectRoot,
  } as any;

  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();
  });

  it('returns the exact installed expo package version', async () => {
    jest.mocked(getInstalledExpoPackageVersionFromProjectAsync).mockResolvedValue('55.0.17');

    await expect(getInstalledExpoPackageVersionAsync(buildContext)).resolves.toBe('55.0.17');
    expect(getInstalledExpoPackageVersionFromProjectAsync).toHaveBeenCalledWith({
      env: buildContext.env,
      projectDir: projectRoot,
    });
  });

  it('throws a user error when expo package version resolution fails', async () => {
    jest
      .mocked(getInstalledExpoPackageVersionFromProjectAsync)
      .mockRejectedValue(new Error('Cannot find module expo/package.json'));

    await expect(getInstalledExpoPackageVersionAsync(buildContext)).rejects.toThrow(
      'Cannot find module expo/package.json'
    );
  });
});

describe(BuildService, () => {
  const projectRoot = '/test-project';
  const job = {
    appId: 'app-id',
    cache: {
      clear: false,
      disabled: false,
      paths: [],
    },
    mode: BuildMode.BUILD,
    platform: Platform.IOS,
    projectArchive: {
      type: ArchiveSourceType.URL,
      url: 'https://example.com/project.tar.gz',
    },
    projectRootDirectory: '.',
    secrets: {
      robotAccessToken: 'robot-token',
    },
    triggeredBy: BuildTrigger.EAS_CLI,
    type: Workflow.GENERIC,
  };

  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();
    jest.mocked(getInstalledExpoPackageVersionFromProjectAsync).mockResolvedValue('55.0.18');
    jest.mocked(turtleFetch).mockResolvedValue({ ok: true } as any);
    jest.mocked(build).mockRejectedValue(new Error('raw build failure'));
    jest.mocked(createBuildContext).mockReturnValue({
      env: { PATH: '/usr/bin' },
      getReactNativeProjectDirectory: () => projectRoot,
      job,
      logger: {},
    } as any);
  });

  it('resolves expo_package_version in the worker without changing sdk_version', async () => {
    const service = new BuildService();
    jest.spyOn(service, 'finishError').mockResolvedValue(undefined);

    await (service as any).startBuildInternal({
      initiatingUserId: 'user-id',
      job,
      metadata: {
        buildProfile: 'production',
        reactNativeVersion: '0.83.0',
        sdkVersion: '55.0.0',
      },
      projectId: 'project-id',
    });

    expect(turtleFetch).toHaveBeenCalledWith(
      'http://api.expo.test/v2/turtle-builds/logs',
      'POST',
      expect.objectContaining({
        json: expect.objectContaining({
          tags: expect.objectContaining({
            expo_package_version: '55.0.18',
            sdk_version: '55.0.0',
          }),
        }),
      })
    );
  });

  it('sends null expo_package_version to Datadog error logs when expo package version resolution fails', async () => {
    jest
      .mocked(getInstalledExpoPackageVersionFromProjectAsync)
      .mockRejectedValue(new Error('Cannot find module expo/package.json'));
    const service = new BuildService();
    jest.spyOn(service, 'finishError').mockResolvedValue(undefined);

    await (service as any).startBuildInternal({
      initiatingUserId: 'user-id',
      job,
      metadata: {
        sdkVersion: '55.0.0',
      },
      projectId: 'project-id',
    });

    expect(turtleFetch).toHaveBeenCalledWith(
      'http://api.expo.test/v2/turtle-builds/logs',
      'POST',
      expect.objectContaining({
        json: expect.objectContaining({
          tags: expect.objectContaining({
            expo_package_version: null,
            sdk_version: '55.0.0',
          }),
        }),
      })
    );
  });

  it('does not try to resolve expo_package_version when build context setup fails', async () => {
    jest.mocked(createBuildContext).mockImplementation(() => {
      throw new Error('context setup failure');
    });
    const service = new BuildService();
    jest.spyOn(service, 'finishError').mockResolvedValue(undefined);

    await (service as any).startBuildInternal({
      initiatingUserId: 'user-id',
      job,
      metadata: {
        sdkVersion: '55.0.0',
      },
      projectId: 'project-id',
    });

    expect(getInstalledExpoPackageVersionFromProjectAsync).not.toHaveBeenCalled();
    expect(turtleFetch).toHaveBeenCalledWith(
      'http://api.expo.test/v2/turtle-builds/logs',
      'POST',
      expect.objectContaining({
        json: expect.objectContaining({
          tags: expect.objectContaining({
            expo_package_version: null,
            sdk_version: '55.0.0',
          }),
        }),
      })
    );
  });
});
