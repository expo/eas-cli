import { BuildPhase, BuildPhaseResult, Platform, errors } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';

import { reportWorkflowCustomMetricsAsync } from '../external/customMetrics';
import BuildService, { getExpoPackageVersionAsync } from '../service';

jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => jest.fn());
jest.mock('../external/customMetrics', () => ({
  reportWorkflowCustomMetricsAsync: jest.fn(),
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
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  createBuildLoggerWithSecretsFilter: jest.fn(),
}));

const reportMetricsMock = jest.mocked(reportWorkflowCustomMetricsAsync);

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

  it('reports the phase as a custom metric when a build context is set', () => {
    const service = new BuildService();
    (service as any).buildContext = { job: { platform: Platform.IOS } };

    service.reportBuildPhaseStats({
      buildPhase: BuildPhase.RUN_FASTLANE,
      result: BuildPhaseResult.SUCCESS,
      durationMs: 1234,
    });

    expect(reportMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({ job: { platform: Platform.IOS } }),
      [
        {
          name: 'eas.workflow.build.phase.duration',
          value: 1234,
          tags: {
            build_phase: BuildPhase.RUN_FASTLANE.toLowerCase(),
            platform: Platform.IOS,
            result: BuildPhaseResult.SUCCESS,
          },
        },
      ]
    );
  });

  it('omits the platform tag when the job has no platform', () => {
    const service = new BuildService();
    (service as any).buildContext = { job: {} };

    service.reportBuildPhaseStats({
      buildPhase: BuildPhase.PREPARE_PROJECT,
      result: BuildPhaseResult.SUCCESS,
      durationMs: 1,
    });

    expect(reportMetricsMock).toHaveBeenCalledTimes(1);
    const tags = reportMetricsMock.mock.calls[0][1][0].tags;
    expect(tags).not.toHaveProperty('platform');
    expect(tags).toMatchObject({ build_phase: 'prepare_project', result: 'success' });
  });

  it('does not report when no build context is set', () => {
    const service = new BuildService();

    service.reportBuildPhaseStats({
      buildPhase: BuildPhase.RUN_FASTLANE,
      result: BuildPhaseResult.SUCCESS,
      durationMs: 1,
    });

    expect(reportMetricsMock).not.toHaveBeenCalled();
  });
});
