import { RuntimeSettings } from '@expo/build-tools';
import { ManagedArtifactType, Platform, Workflow } from '@expo/eas-build-job';

import config from '../config';
import { createBuildContext } from '../context';
import { getBuildEnv } from '../env';
import { maybeStopWarmSimulatorAsync } from '../warmSimulator';
import { prepareRuntimeEnvironmentConfigFiles } from '../runtimeEnvironment';
import { uploadSourceMapAsync } from '../upload';

jest.mock('../warmSimulator');
jest.mock('../env', () => ({
  getBuildEnv: jest.fn(() => ({
    __API_SERVER_URL: 'http://api.expo.test',
    PATH: '/usr/bin',
  })),
}));
jest.mock('../runtimeEnvironment', () => ({
  prepareRuntimeEnvironmentConfigFiles: jest.fn(async () => {}),
}));
jest.mock('../upload', () => ({
  ...jest.requireActual('../upload'),
  uploadSourceMapAsync: jest.fn(async () => ({ filename: null })),
  uploadWithAnalyticsAsync: jest.fn(async fn => await fn()),
}));

describe(createBuildContext.name, () => {
  const childLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  } as any;
  const buildLogger = {
    child: jest.fn(() => childLogger),
  } as any;
  const baseOptions = {
    logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
    analytics: {} as any,
    metadata: {},
    projectId: 'project-id',
    buildId: 'build-id',
    buildLogger,
    addBuildLogMask: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(maybeStopWarmSimulatorAsync).mockReset().mockResolvedValue(undefined);
    jest.spyOn(RuntimeSettings, 'loadAsync').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('awaits the stop decision after runtime settings and before preparing config files', async () => {
    let finishStop!: () => void;
    const stopping = new Promise<void>(resolve => {
      finishStop = resolve;
    });
    jest.mocked(maybeStopWarmSimulatorAsync).mockReturnValue(stopping);
    const job = { platform: Platform.IOS } as any;
    const creating = createBuildContext({ ...baseOptions, job });
    await Promise.resolve();
    expect(RuntimeSettings.loadAsync).toHaveBeenCalledTimes(1);
    expect(maybeStopWarmSimulatorAsync).toHaveBeenCalledWith(job);
    expect(jest.mocked(RuntimeSettings.loadAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(maybeStopWarmSimulatorAsync).mock.invocationCallOrder[0]
    );
    expect(prepareRuntimeEnvironmentConfigFiles).not.toHaveBeenCalled();
    finishStop();
    await creating;
    expect(prepareRuntimeEnvironmentConfigFiles).toHaveBeenCalledTimes(1);
  });

  it('does not prepare runtime config files or build env when stopping fails', async () => {
    const error = new Error('Simulator stop acknowledgement failed');
    jest.mocked(maybeStopWarmSimulatorAsync).mockRejectedValue(error);
    await expect(
      createBuildContext({ ...baseOptions, job: { platform: Platform.IOS } as any })
    ).rejects.toBe(error);
    expect(RuntimeSettings.loadAsync).toHaveBeenCalledTimes(1);
    expect(prepareRuntimeEnvironmentConfigFiles).not.toHaveBeenCalled();
    expect(getBuildEnv).not.toHaveBeenCalled();
  });

  it('loads runtime settings with the job environment before creating build env', async () => {
    const env = { EAS_USE_NPM_CACHE: '1' };

    await createBuildContext({
      ...baseOptions,
      job: {
        platform: Platform.IOS,
        type: Workflow.GENERIC,
        secrets: { environmentSecrets: [] },
        builderEnvironment: { env },
        environment: 'preview',
      } as any,
    });

    expect(RuntimeSettings.loadAsync).toHaveBeenCalledWith({
      environment: config.env,
      env,
    });
    expect(prepareRuntimeEnvironmentConfigFiles).toHaveBeenCalled();
    expect(jest.mocked(RuntimeSettings.loadAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(getBuildEnv).mock.invocationCallOrder[0]
    );
  });

  it('loads runtime settings without job env when the job has no builder environment', async () => {
    await createBuildContext({
      ...baseOptions,
      job: {
        platform: Platform.ANDROID,
        type: Workflow.GENERIC,
        secrets: { environmentSecrets: [] },
      } as any,
    });

    expect(RuntimeSettings.loadAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: config.env,
        env: undefined,
      })
    );
  });

  it('adds the MCP server URL to the build context', async () => {
    const ctx = await createBuildContext({
      ...baseOptions,
      job: {
        platform: Platform.ANDROID,
        type: Workflow.GENERIC,
        secrets: { environmentSecrets: [] },
      } as any,
    });

    expect(ctx.mcpServerUrl).toBe(config.mcpServerUrl);
  });

  it('routes managed source maps to the source-map uploader', async () => {
    const ctx = await createBuildContext({
      ...baseOptions,
      job: {
        platform: Platform.ANDROID,
        type: Workflow.GENERIC,
        secrets: { environmentSecrets: [] },
      } as any,
    });

    await ctx.uploadArtifact({
      artifact: {
        type: ManagedArtifactType.SOURCE_MAP,
        paths: ['/workingdir/observe-source-maps/android.map'],
      },
      logger: childLogger,
    });

    expect(uploadSourceMapAsync).toHaveBeenCalledWith(ctx, {
      sourceMapPath: '/workingdir/observe-source-maps/android.map',
      buildId: baseOptions.buildId,
      logger: childLogger,
    });
  });
});
