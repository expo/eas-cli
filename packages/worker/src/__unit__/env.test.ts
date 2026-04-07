import { Platform, Workflow } from '@expo/eas-build-job';

import config from '../config';
import { getBuildEnv } from '../env';

describe(getBuildEnv.name, () => {
  const originalSentryDsn = config.sentry.dsn;
  const originalNestedVirt = config.capabilities.nestedVirtualizationEnabled;

  afterEach(() => {
    config.sentry.dsn = originalSentryDsn;
    config.capabilities.nestedVirtualizationEnabled = originalNestedVirt;
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

  it('passes through EXPO_USE_PRECOMPILED_MODULES for flagged iOS jobs', () => {
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
    expect(env.EXPO_PRECOMPILED_MODULES_PATH).toBeUndefined();
  });

  it('sets EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED from worker capabilities when known', () => {
    config.capabilities.nestedVirtualizationEnabled = true;

    const env = getBuildEnv({
      job: {
        platform: Platform.ANDROID,
        type: Workflow.MANAGED,
        builderEnvironment: { env: {} },
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

    expect(env.EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED).toBe('1');
  });

  it('sets EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED to 0 when nested virt is disabled', () => {
    config.capabilities.nestedVirtualizationEnabled = false;

    const env = getBuildEnv({
      job: {
        platform: Platform.ANDROID,
        type: Workflow.MANAGED,
        builderEnvironment: { env: {} },
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

    expect(env.EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED).toBe('0');
  });

  it('defaults EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED to 0 when capability defaults to false', () => {
    const env = getBuildEnv({
      job: {
        platform: Platform.ANDROID,
        type: Workflow.MANAGED,
        builderEnvironment: { env: {} },
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

    expect(env.EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED).toBe('0');
  });
});
