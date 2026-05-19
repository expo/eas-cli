import { Datadog } from '@expo/build-tools';
import { BuildPhase, BuildPhaseResult, Job, errors } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';

import { build } from '../build';
import { createBuildContext } from '../context';
import { createBuildLoggerWithSecretsFilter } from '../logger';
import BuildService, { getExpoPackageVersionAsync } from '../service';

jest.mock('fs');
jest.mock('@expo/build-tools', () => {
  const actual = jest.requireActual('@expo/build-tools');
  return {
    ...actual,
    GCS: { uploadWithSignedUrl: jest.fn() },
    Datadog: {
      setup: jest.fn(),
      flushAsync: jest.fn(async () => {}),
    },
  };
});
jest.mock('@expo/turtle-spawn', () => jest.fn());
jest.mock('../build', () => ({
  build: jest.fn(),
}));
jest.mock('../context', () => ({
  createBuildContext: jest.fn(() => ({ job: {} })),
}));
jest.mock('../config', () => {
  const actual = jest.requireActual('../config').default;
  return {
    __esModule: true,
    default: { ...actual, buildId: 'build-id' },
  };
});
jest.mock('../logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    level: jest.fn(),
  },
  createBuildLoggerWithSecretsFilter: jest.fn(),
}));

const buildMock = jest.mocked(build);
const createBuildContextMock = jest.mocked(createBuildContext);
const createBuildLoggerWithSecretsFilterMock = jest.mocked(createBuildLoggerWithSecretsFilter);
const datadogSetupMock = jest.mocked(Datadog.setup);
const datadogFlushAsyncMock = jest.mocked(Datadog.flushAsync);

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

describe('BuildService.reportBuildPhaseStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends phase stats to the launcher websocket', () => {
    const send = jest.fn();
    const service = new BuildService();
    service.setWS({ send } as any);

    const stats = {
      buildPhase: BuildPhase.RUN_FASTLANE,
      result: BuildPhaseResult.SUCCESS,
      durationMs: 1234,
    };
    service.reportBuildPhaseStats(stats);

    expect(send).toHaveBeenCalledWith({
      type: 'build-phase-stats',
      ...stats,
    });
  });

  it('does not send phase stats when there is no launcher websocket', () => {
    const service = new BuildService();

    service.reportBuildPhaseStats({
      buildPhase: BuildPhase.PREPARE_PROJECT,
      result: BuildPhaseResult.SUCCESS,
      durationMs: 1,
    });

    expect(datadogSetupMock).not.toHaveBeenCalled();
  });
});

describe('BuildService Datadog setup', () => {
  const buildLogger = { child: jest.fn(() => buildLogger) } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    buildMock.mockResolvedValue({});
    createBuildContextMock.mockReturnValue({ job: {} } as any);
    createBuildLoggerWithSecretsFilterMock.mockResolvedValue({
      logger: buildLogger,
      cleanUp: jest.fn(async () => {}),
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] } as any,
      outputStream: {} as any,
    });
  });

  it('configures Datadog for build jobs', async () => {
    const service = new BuildService();
    service.checkForHangingWorker = jest.fn(async () => {});

    await (service as any).startBuildInternal({
      job: {
        platform: 'ios',
        secrets: { robotAccessToken: 'token-abc' },
      } as Job,
      metadata: {},
      projectId: 'project-id',
      initiatingUserId: 'user-id',
    });

    expect(datadogSetupMock).toHaveBeenCalledWith({
      expoApiV2BaseUrl: expect.any(String),
      turtleBuildId: 'build-id',
      robotAccessToken: 'token-abc',
    });
    expect(createBuildContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reportBuildPhaseStatsFn: expect.any(Function),
      })
    );
    expect(datadogFlushAsyncMock).toHaveBeenCalled();
  });

  it('configures Datadog for non-platform jobs with the turtle build id', async () => {
    const service = new BuildService();
    service.checkForHangingWorker = jest.fn(async () => {});

    await (service as any).startBuildInternal({
      job: {
        secrets: { robotAccessToken: 'token-abc' },
      } as Job,
      metadata: {},
      projectId: 'project-id',
      initiatingUserId: 'user-id',
    });

    expect(datadogSetupMock).toHaveBeenCalledWith({
      expoApiV2BaseUrl: expect.any(String),
      turtleBuildId: 'build-id',
      robotAccessToken: 'token-abc',
    });
    expect(createBuildContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reportBuildPhaseStatsFn: expect.any(Function),
      })
    );
  });

  it('leaves Datadog unconfigured when the robot access token is unavailable', async () => {
    const service = new BuildService();
    service.checkForHangingWorker = jest.fn(async () => {});

    await (service as any).startBuildInternal({
      job: {
        platform: 'ios',
        secrets: {},
      } as Job,
      metadata: {},
      projectId: 'project-id',
      initiatingUserId: 'user-id',
    });

    expect(datadogSetupMock).not.toHaveBeenCalled();
  });
});
