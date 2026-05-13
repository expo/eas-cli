import {
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  Platform,
  Workflow,
} from '@expo/eas-build-job';
import { vol } from 'memfs';

import { build } from '../build';
import { createBuildContext } from '../context';
import BuildService from '../service';
import { turtleFetch } from '../utils/turtleFetch';

jest.mock('fs');
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
    jest.mocked(turtleFetch).mockResolvedValue({ ok: true } as any);
    jest.mocked(build).mockRejectedValue(new Error('raw build failure'));
    jest.mocked(createBuildContext).mockReturnValue({
      env: { PATH: '/usr/bin' },
      getReactNativeProjectDirectory: () => projectRoot,
      job,
      logger: {},
    } as any);
  });

  it('uses expo_package_version from build metadata without changing sdk_version', async () => {
    const service = new BuildService();
    jest.spyOn(service, 'finishError').mockResolvedValue(undefined);

    await (service as any).startBuildInternal({
      initiatingUserId: 'user-id',
      job,
      metadata: {
        buildProfile: 'production',
        expoPackageVersion: '55.0.18',
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

  it('sends null expo_package_version to Datadog error logs when metadata does not include it', async () => {
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

  it('sends null expo_package_version when build context setup fails before metadata is available', async () => {
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
