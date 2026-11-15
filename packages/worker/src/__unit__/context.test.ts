import { RuntimeSettings } from '@expo/build-tools';
import { ManagedArtifactType, Platform, Workflow } from '@expo/eas-build-job';

import config from '../config';
import { createBuildContext } from '../context';
import { getBuildEnv } from '../env';
import { maybeStopWarmSimulatorAsync } from '../warmSimulator';
import { prepareRuntimeEnvironmentConfigFiles } from '../runtimeEnvironment';
import { uploadSourceMapAsync, uploadWorkflowArtifactAsync } from '../upload';

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
  uploadWorkflowArtifactAsync: jest.fn(async () => ({ artifactId: 'artifact-id' })),
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
    jest.mocked(prepareRuntimeEnvironmentConfigFiles).mockReset().mockResolvedValue();
    jest.spyOn(RuntimeSettings, 'loadAsync').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts shutdown after runtime settings without blocking setup or context creation', async () => {
    let finishStop!: () => void;
    let failStop!: (error: Error) => void;
    const stopping = new Promise<void>((resolve, reject) => {
      finishStop = resolve;
      failStop = reject;
    });
    jest.mocked(maybeStopWarmSimulatorAsync).mockReturnValue(stopping);
    const job = { platform: Platform.IOS } as any;
    let created = false;
    const creating = createBuildContext({ ...baseOptions, job }).then(ctx => {
      created = true;
      return ctx;
    });
    try {
      for (let turn = 0; turn < 20 && !created; turn++) {
        await Promise.resolve();
      }
      expect(created).toBe(true);
      expect(maybeStopWarmSimulatorAsync).toHaveBeenCalledWith(job);
      expect(jest.mocked(RuntimeSettings.loadAsync).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(maybeStopWarmSimulatorAsync).mock.invocationCallOrder[0]
      );
      expect(prepareRuntimeEnvironmentConfigFiles).toHaveBeenCalledTimes(1);
      const error = new Error('Late Simulator shutdown failure');
      failStop(error);
      await new Promise(resolve => setImmediate(resolve));
      expect(childLogger.warn).toHaveBeenCalledWith(
        { err: error },
        'Could not stop warm Simulator services.'
      );
    } finally {
      finishStop();
      await creating;
    }
  });

  it('warns and continues setup when shutdown rejects immediately', async () => {
    const error = new Error('Simulator stop failed');
    jest.mocked(maybeStopWarmSimulatorAsync).mockRejectedValue(error);
    await createBuildContext({ ...baseOptions, job: { platform: Platform.IOS } as any });
    expect(childLogger.warn).toHaveBeenCalledWith(
      { err: error },
      'Could not stop warm Simulator services.'
    );
    expect(prepareRuntimeEnvironmentConfigFiles).toHaveBeenCalledTimes(1);
    expect(getBuildEnv).toHaveBeenCalledTimes(1);
  });

  it('preserves an unrelated setup failure even if background shutdown also fails', async () => {
    const stopError = new Error('Simulator stop failed');
    const setupError = new Error('Could not prepare runtime config');
    jest.mocked(maybeStopWarmSimulatorAsync).mockRejectedValue(stopError);
    jest.mocked(prepareRuntimeEnvironmentConfigFiles).mockRejectedValueOnce(setupError);
    await expect(
      createBuildContext({ ...baseOptions, job: { platform: Platform.IOS } as any })
    ).rejects.toBe(setupError);
    expect(childLogger.warn).toHaveBeenCalledWith(
      { err: stopError },
      'Could not stop warm Simulator services.'
    );
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
  it('uploads named artifacts to workflow storage and returns their ID', async () => {
    const ctx = await createBuildContext({
      ...baseOptions,
      job: {
        type: Workflow.GENERIC,
        secrets: { environmentSecrets: [] },
      } as any,
    });
    const metadata = { kind: 'maestro-report' };

    const result = await ctx.uploadArtifact({
      artifact: { type: null, name: 'Report', paths: ['/workingdir/report'], metadata },
      logger: childLogger,
    });

    expect(uploadWorkflowArtifactAsync).toHaveBeenCalledWith(ctx, {
      artifactPaths: ['/workingdir/report'],
      name: 'Report',
      metadata,
      logger: childLogger,
    });
    expect(result).toEqual({ artifactId: 'artifact-id' });
    expect(ctx.artifacts).toEqual({});
  });
});
