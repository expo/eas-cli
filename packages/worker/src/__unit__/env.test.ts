import { PRECOMPILED_MODULES_PATH } from '@expo/build-tools';
import { Platform, Workflow } from '@expo/eas-build-job';

import config from '../config';
import { getBuildEnv } from '../env';

describe(getBuildEnv.name, () => {
  const originalSentryDsn = config.sentry.dsn;

  afterEach(() => {
    config.sentry.dsn = originalSentryDsn;
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

  it('enables precompiled modules env vars for flagged iOS jobs', () => {
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

    expect(env.EXPO_USE_PRECOMPILED_MODULES).toBe('1');
    expect(env.EXPO_PRECOMPILED_MODULES_PATH).toBe(PRECOMPILED_MODULES_PATH);
  });
});
