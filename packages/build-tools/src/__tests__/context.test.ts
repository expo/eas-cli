import {
  BuildPhase,
  BuildPhaseResult,
  BuildTrigger,
  Job,
  Metadata,
  Platform,
} from '@expo/eas-build-job';
import { randomUUID } from 'crypto';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { createMockLogger } from './utils/logger';
import { BuildContext } from '../context';
import { Datadog } from '../datadog';

jest.mock('fs');
jest.mock('fs-extra');
jest.mock('../datadog', () => ({
  Datadog: {
    distribution: jest.fn(),
    log: jest.fn(),
  },
}));

const datadogDistributionMock = jest.mocked(Datadog.distribution);
const datadogLogMock = jest.mocked(Datadog.log);

describe('BuildContext', () => {
  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();
    (fs.readdir as unknown as jest.Mock).mockResolvedValue([]);
  });

  it('should merge secrets', async () => {
    const robotAccessToken = randomUUID();
    await vol.promises.mkdir('/workingdir/eas-environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        secrets: {
          robotAccessToken,
          environmentSecrets: [
            {
              name: 'TEST_SECRET',
              value: 'test-secret-value',
            },
          ],
        },
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );

    ctx.updateJobInformation({} as Job, {} as Metadata);

    expect(ctx.job.secrets).toEqual({
      robotAccessToken,
      environmentSecrets: [
        {
          name: 'TEST_SECRET',
          value: 'test-secret-value',
        },
      ],
    });

    const newRobotAccessToken = randomUUID();
    ctx.updateJobInformation(
      {
        secrets: {
          robotAccessToken: newRobotAccessToken,
          environmentSecrets: [
            {
              name: 'TEST_SECRET',
              value: 'new-test-secret-value',
            },
            {
              name: 'TEST_SECRET_2',
              value: 'test-secret-value-2',
            },
          ],
        },
      } as Job,
      {} as Metadata
    );

    expect(ctx.job.secrets).toEqual({
      robotAccessToken: newRobotAccessToken,
      environmentSecrets: [
        { name: 'TEST_SECRET', value: 'test-secret-value' },
        { name: 'TEST_SECRET', value: 'new-test-secret-value' },
        { name: 'TEST_SECRET_2', value: 'test-secret-value-2' },
      ],
    });
  });

  it('should not lose workflowInterpolationContext', async () => {
    const robotAccessToken = randomUUID();
    await vol.promises.mkdir('/workingdir/eas-environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        secrets: {
          robotAccessToken,
          environmentSecrets: [
            {
              name: 'TEST_SECRET',
              value: 'test-secret-value',
            },
          ],
        },
        workflowInterpolationContext: {
          foo: 'bar',
        } as any,
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );

    ctx.updateJobInformation({} as Job, {} as Metadata);

    expect(ctx.job.workflowInterpolationContext).toEqual({
      foo: 'bar',
    });
  });

  it('overwrites existing environment variables when updating env', async () => {
    await vol.promises.mkdir('/workingdir/eas-environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        secrets: {},
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
          EXISTING_ENV: 'old-value',
          REMOVED_ENV: 'old-value',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );

    ctx.updateEnv({
      EXISTING_ENV: 'new-value',
      REMOVED_ENV: undefined,
      NEW_ENV: 'new-env-value',
    });

    expect(ctx.env.EXISTING_ENV).toBe('new-value');
    expect(ctx.env.REMOVED_ENV).toBeUndefined();
    expect(ctx.env.NEW_ENV).toBe('new-env-value');
    const logMessage = datadogLogMock.mock.calls[0][0];
    expect(logMessage).toContain('BuildContext.updateEnv merge order produced different env');
    expect(logMessage).toContain('different_env_names=');
    expect(logMessage).toContain('EXISTING_ENV');
    expect(logMessage).toContain('REMOVED_ENV');
    expect(JSON.stringify(datadogLogMock.mock.calls)).not.toContain('old-value');
    expect(JSON.stringify(datadogLogMock.mock.calls)).not.toContain('new-value');
    expect(JSON.stringify(datadogLogMock.mock.calls)).not.toContain('new-env-value');
  });

  it('logs when updateEnv merge order produces the same env without values', async () => {
    await vol.promises.mkdir('/workingdir/eas-environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        secrets: {},
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
          EXISTING_ENV: 'same-value',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );

    ctx.updateEnv({
      EXISTING_ENV: 'same-value',
      UNSET_ENV: undefined,
    });

    expect(datadogLogMock).toHaveBeenCalledWith(
      'BuildContext.updateEnv merge order produced same env'
    );
    expect(JSON.stringify(datadogLogMock.mock.calls)).not.toContain('same-value');
  });

  it('emits build phase duration metrics for successful build phases', async () => {
    const ctx = createTestBuildContext({ platform: Platform.IOS });

    await ctx.runBuildPhase(BuildPhase.RUN_FASTLANE, async () => {});

    expect(datadogDistributionMock).toHaveBeenCalledWith(
      'eas.build.phase_duration',
      expect.any(Number),
      {
        build_phase: 'run_fastlane',
        platform: Platform.IOS,
        result: BuildPhaseResult.SUCCESS,
      }
    );
  });

  it('emits build phase duration metrics for failed build phases', async () => {
    const ctx = createTestBuildContext({ platform: Platform.ANDROID });

    await expect(
      ctx.runBuildPhase(BuildPhase.INSTALL_DEPENDENCIES, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow();

    expect(datadogDistributionMock).toHaveBeenCalledWith(
      'eas.build.phase_duration',
      expect.any(Number),
      {
        build_phase: 'install_dependencies',
        platform: Platform.ANDROID,
        result: BuildPhaseResult.FAIL,
      }
    );
  });

  it('does not emit build phase duration metrics for non-platform jobs', async () => {
    const ctx = createTestBuildContext({});

    await ctx.runBuildPhase(BuildPhase.PREPARE_PROJECT, async () => {});

    expect(datadogDistributionMock).not.toHaveBeenCalled();
  });
});

function createTestBuildContext({ platform }: { platform?: Platform }): BuildContext {
  vol.mkdirSync('/workingdir/env', { recursive: true });

  return new BuildContext(
    {
      ...(platform ? { platform } : {}),
      builderEnvironment: { env: {} },
    } as Job,
    {
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
      },
      workingdir: '/workingdir',
      logger: createMockLogger(),
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      uploadArtifact: jest.fn(),
    }
  );
}
