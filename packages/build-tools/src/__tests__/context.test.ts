import {
  BuildPhase,
  BuildPhaseResult,
  BuildTrigger,
  Job,
  Metadata,
  Platform,
  Workflow,
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
  },
}));

const datadogDistributionMock = jest.mocked(Datadog.distribution);

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
          EAS_BUILD_ANDROID_VERSION_CODE: 'old-version-code',
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
  });

  it('updates environment variables from resolved job information', async () => {
    await vol.promises.mkdir('/workingdir/eas-environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        secrets: {},
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

    ctx.updateJobInformation(
      {
        platform: Platform.ANDROID,
        type: Workflow.MANAGED,
        username: 'job-username',
        version: {
          versionCode: '42',
          versionName: '1.2.3',
        },
      } as Job,
      {
        buildProfile: 'production',
        gitCommitHash: 'abc123',
      } as Metadata
    );

    expect(ctx.env).toEqual(
      expect.objectContaining({
        EAS_BUILD_PROFILE: 'production',
        EAS_BUILD_GIT_COMMIT_HASH: 'abc123',
        EAS_BUILD_USERNAME: 'job-username',
        EAS_BUILD_ANDROID_VERSION_CODE: '42',
        EAS_BUILD_ANDROID_VERSION_NAME: '1.2.3',
      })
    );
  });

  it('overwrites stale environment variables from resolved job information', async () => {
    await vol.promises.mkdir('/workingdir/eas-environment-secrets/', { recursive: true });

    const ctx = new BuildContext(
      {
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        platform: Platform.IOS,
        secrets: {},
      } as Job,
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
          EAS_BUILD_PROFILE: 'old-profile',
          EAS_BUILD_USERNAME: 'old-username',
          EAS_BUILD_ANDROID_VERSION_CODE: 'old-version-code',
          EAS_BUILD_IOS_BUILD_NUMBER: 'old-build-number',
        },
        workingdir: '/workingdir',
        logger: createMockLogger(),
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        uploadArtifact: jest.fn(),
      }
    );

    ctx.updateJobInformation(
      {
        platform: Platform.ANDROID,
        type: Workflow.MANAGED,
        username: 'new-username',
        version: {
          versionCode: '42',
          versionName: '1.2.3',
        },
      } as Job,
      {
        buildProfile: 'new-profile',
      } as Metadata
    );

    expect(ctx.env.EAS_BUILD_PROFILE).toBe('new-profile');
    expect(ctx.env.EAS_BUILD_USERNAME).toBe('new-username');
    expect(ctx.env.EAS_BUILD_ANDROID_VERSION_CODE).toBe('42');
    expect(ctx.env.EAS_BUILD_IOS_BUILD_NUMBER).toBeUndefined();
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
