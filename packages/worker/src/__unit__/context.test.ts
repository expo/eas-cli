import { RuntimeSettings } from '@expo/build-tools';
import { Platform, Workflow } from '@expo/eas-build-job';

import config from '../config';
import { createBuildContext } from '../context';
import { getBuildEnv } from '../env';
import { prepareRuntimeEnvironmentConfigFiles } from '../runtimeEnvironment';

jest.mock('../env', () => ({
  getBuildEnv: jest.fn(() => ({
    __API_SERVER_URL: 'http://api.expo.test',
    PATH: '/usr/bin',
  })),
}));
jest.mock('../runtimeEnvironment', () => ({
  prepareRuntimeEnvironmentConfigFiles: jest.fn(async () => {}),
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(RuntimeSettings, 'loadAsync').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
});
