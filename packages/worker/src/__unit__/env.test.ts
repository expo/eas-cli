import { Platform, Workflow } from '@expo/eas-build-job';
import os from 'os';

import config from '../config';
import { getBuildEnv, getGradleMemoryOptions } from '../env';

describe(getBuildEnv.name, () => {
  const originalSentryDsn = config.sentry.dsn;

  afterEach(() => {
    config.sentry.dsn = originalSentryDsn;
    jest.restoreAllMocks();
  });

  it('passes the CLI sentry DSN to worker child processes', () => {
    config.sentry.dsn = 'https://public@example.ingest.sentry.io/1';

    const env = getBuildEnv({
      job: {
        platform: Platform.ANDROID,
        type: Workflow.MANAGED,
        builderEnvironment: {
          env: {},
        },
        username: 'expo-user',
      } as any,
      projectId: 'project-id',
      metadata: {
        buildProfile: 'production',
        gitCommitHash: 'abc123',
        username: 'expo-user',
      } as any,
      buildId: 'build-id',
    });

    expect(env.EAS_CLI_SENTRY_DSN).toBe(config.sentry.dsn);
  });

  it('does not add precompiled modules env vars to flagged iOS jobs', () => {
    const env = getBuildEnv({
      job: {
        platform: Platform.IOS,
        type: Workflow.GENERIC,
        builderEnvironment: {
          env: {
            EAS_USE_PRECOMPILED_MODULES: '1',
          },
        },
      } as any,
      projectId: 'project-id',
      metadata: {
        buildProfile: 'production',
        gitCommitHash: 'abc123',
        username: 'expo-user',
      } as any,
      buildId: 'build-id',
    });

    expect(env.EAS_USE_PRECOMPILED_MODULES).toBeUndefined();
    expect(env.EXPO_USE_PRECOMPILED_MODULES).toBeUndefined();
    expect(env.EXPO_PRECOMPILED_MODULES_BASE_URL).toBeUndefined();
    expect(env.EXPO_PRECOMPILED_MODULES_PATH).toBeUndefined();
  });

  it('sizes Gradle memory options from total memory', () => {
    const totalMemory = jest.spyOn(os, 'totalmem');

    totalMemory.mockReturnValue(16 * 1024 ** 3);
    expect(getGradleMemoryOptions()).toEqual({
      maxHeapSize: '4g',
    });

    totalMemory.mockReturnValue(32 * 1024 ** 3);
    expect(getGradleMemoryOptions()).toEqual({
      maxHeapSize: '8g',
    });
  });

  it('keeps Gradle memory options conservative on low-memory runners', () => {
    jest.spyOn(os, 'totalmem').mockReturnValue(4 * 1024 ** 3);

    expect(getGradleMemoryOptions()).toEqual({
      maxHeapSize: '1g',
    });
  });
});
