import { RuntimeSettings } from '@expo/build-tools';
import { Platform, Workflow } from '@expo/eas-build-job';
import os from 'os';

import config from '../config';
import { getBuildEnv, getGradleMemoryOptions } from '../env';

describe(getBuildEnv.name, () => {
  const originalSentryDsn = config.sentry.dsn;
  const originalPlatform = process.platform;
  const originalCacheUrls = {
    EAS_NPM_CACHE_URL: process.env.EAS_NPM_CACHE_URL,
    EAS_NODEJS_CACHE_URL: process.env.EAS_NODEJS_CACHE_URL,
    EAS_MAVEN_CACHE_URL: process.env.EAS_MAVEN_CACHE_URL,
    EAS_COCOAPODS_CACHE_URL: process.env.EAS_COCOAPODS_CACHE_URL,
    EAS_BUILD_NPM_CACHE_URL: process.env.EAS_BUILD_NPM_CACHE_URL,
    NPM_CACHE_URL: process.env.NPM_CACHE_URL,
    NVM_NODEJS_ORG_MIRROR: process.env.NVM_NODEJS_ORG_MIRROR,
    EAS_BUILD_MAVEN_CACHE_URL: process.env.EAS_BUILD_MAVEN_CACHE_URL,
    EAS_BUILD_COCOAPODS_CACHE_URL: process.env.EAS_BUILD_COCOAPODS_CACHE_URL,
    NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY,
  };

  beforeEach(() => {
    delete process.env.EAS_BUILD_NPM_CACHE_URL;
    delete process.env.NPM_CACHE_URL;
    delete process.env.NVM_NODEJS_ORG_MIRROR;
    delete process.env.EAS_BUILD_MAVEN_CACHE_URL;
    delete process.env.EAS_BUILD_COCOAPODS_CACHE_URL;
    delete process.env.NPM_CONFIG_REGISTRY;
    jest.spyOn(RuntimeSettings, 'getNpmCacheUrl').mockReturnValue(null);
    jest.spyOn(RuntimeSettings, 'getNodeJsCacheUrl').mockReturnValue(null);
    jest.spyOn(RuntimeSettings, 'getMavenCacheUrl').mockReturnValue(null);
    jest.spyOn(RuntimeSettings, 'getCocoapodsCacheUrl').mockReturnValue(null);
    jest.spyOn(RuntimeSettings, 'isUsingIosPrecompiledModulesEnabled').mockReturnValue(false);
  });

  afterEach(() => {
    config.sentry.dsn = originalSentryDsn;
    restoreEnv('EAS_NPM_CACHE_URL', originalCacheUrls.EAS_NPM_CACHE_URL);
    restoreEnv('EAS_NODEJS_CACHE_URL', originalCacheUrls.EAS_NODEJS_CACHE_URL);
    restoreEnv('EAS_MAVEN_CACHE_URL', originalCacheUrls.EAS_MAVEN_CACHE_URL);
    restoreEnv('EAS_COCOAPODS_CACHE_URL', originalCacheUrls.EAS_COCOAPODS_CACHE_URL);
    restoreEnv('EAS_BUILD_NPM_CACHE_URL', originalCacheUrls.EAS_BUILD_NPM_CACHE_URL);
    restoreEnv('NPM_CACHE_URL', originalCacheUrls.NPM_CACHE_URL);
    restoreEnv('NVM_NODEJS_ORG_MIRROR', originalCacheUrls.NVM_NODEJS_ORG_MIRROR);
    restoreEnv('EAS_BUILD_MAVEN_CACHE_URL', originalCacheUrls.EAS_BUILD_MAVEN_CACHE_URL);
    restoreEnv('EAS_BUILD_COCOAPODS_CACHE_URL', originalCacheUrls.EAS_BUILD_COCOAPODS_CACHE_URL);
    restoreEnv('NPM_CONFIG_REGISTRY', originalCacheUrls.NPM_CONFIG_REGISTRY);
    mockProcessPlatform(originalPlatform);
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

  it('adds precompiled modules env vars for iOS jobs when enabled', () => {
    jest.mocked(RuntimeSettings.isUsingIosPrecompiledModulesEnabled).mockReturnValue(true);

    const env = getBuildEnv({
      job: {
        platform: Platform.IOS,
        type: Workflow.GENERIC,
        builderEnvironment: {
          env: {},
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

    expect(env.EAS_USE_PRECOMPILED_MODULES).toBe('1');
  });

  it('does not add precompiled modules env vars for Android jobs when enabled', () => {
    jest.mocked(RuntimeSettings.isUsingIosPrecompiledModulesEnabled).mockReturnValue(true);

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

    expect(env.EAS_USE_PRECOMPILED_MODULES).toBeUndefined();
  });

  it('leaves job-provided precompiled modules env vars in override position', () => {
    jest.mocked(RuntimeSettings.isUsingIosPrecompiledModulesEnabled).mockReturnValue(true);

    const job = {
      platform: Platform.IOS,
      type: Workflow.GENERIC,
      builderEnvironment: {
        env: {
          EAS_USE_PRECOMPILED_MODULES: '0',
        },
      },
    } as any;
    const baseEnv = getBuildEnv({
      job,
      projectId: 'project-id',
      metadata: {
        buildProfile: 'production',
        gitCommitHash: 'abc123',
        username: 'expo-user',
      } as any,
      buildId: 'build-id',
    });

    expect({ ...baseEnv, ...job.builderEnvironment.env }.EAS_USE_PRECOMPILED_MODULES).toBe('0');
  });

  it('does not expose disabled Linux cache URLs in build env', () => {
    mockProcessPlatform('linux');
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';
    process.env.EAS_NODEJS_CACHE_URL = 'https://node.example';
    process.env.EAS_MAVEN_CACHE_URL = 'https://maven.example';

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

    expect(env.NPM_CACHE_URL).toBeUndefined();
    expect(env.NPM_CONFIG_REGISTRY).toBeUndefined();
    expect(env.NVM_NODEJS_ORG_MIRROR).toBeUndefined();
    expect(env.EAS_BUILD_NPM_CACHE_URL).toBeUndefined();
    expect(env.EAS_BUILD_MAVEN_CACHE_URL).toBeUndefined();
    expect(env.EAS_NPM_CACHE_URL).toBeUndefined();
    expect(env.EAS_NODEJS_CACHE_URL).toBeUndefined();
    expect(env.EAS_MAVEN_CACHE_URL).toBeUndefined();
  });

  it('does not expose disabled Darwin cache URLs in build env', () => {
    mockProcessPlatform('darwin');
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';
    process.env.EAS_NODEJS_CACHE_URL = 'https://node.example';
    process.env.EAS_COCOAPODS_CACHE_URL = 'https://pods.example';

    const env = getBuildEnv({
      job: {
        platform: Platform.IOS,
        type: Workflow.GENERIC,
        builderEnvironment: {
          env: {},
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

    expect(env.NPM_CACHE_URL).toBeUndefined();
    expect(env.NPM_CONFIG_REGISTRY).toBeUndefined();
    expect(env.NVM_NODEJS_ORG_MIRROR).toBeUndefined();
    expect(env.EAS_BUILD_NPM_CACHE_URL).toBeUndefined();
    expect(env.EAS_BUILD_COCOAPODS_CACHE_URL).toBeUndefined();
    expect(env.EAS_NPM_CACHE_URL).toBeUndefined();
    expect(env.EAS_NODEJS_CACHE_URL).toBeUndefined();
    expect(env.EAS_COCOAPODS_CACHE_URL).toBeUndefined();
  });

  it('exposes enabled cache URLs inferred from private worker environment variables', () => {
    mockProcessPlatform('linux');
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';
    process.env.EAS_NODEJS_CACHE_URL = 'https://node.example';
    process.env.EAS_MAVEN_CACHE_URL = 'https://maven.example';
    jest.mocked(RuntimeSettings.getNpmCacheUrl).mockReturnValue('https://npm.example');
    jest.mocked(RuntimeSettings.getNodeJsCacheUrl).mockReturnValue('https://node.example');
    jest.mocked(RuntimeSettings.getMavenCacheUrl).mockReturnValue('https://maven.example');

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

    expect(env.NPM_CACHE_URL).toBe('https://npm.example');
    expect(env.NPM_CONFIG_REGISTRY).toBeUndefined();
    expect(env.EAS_BUILD_NPM_CACHE_URL).toBe('https://npm.example');
    expect(env.NVM_NODEJS_ORG_MIRROR).toBe('https://node.example');
    expect(env.EAS_BUILD_MAVEN_CACHE_URL).toBe('https://maven.example');
    expect(env.EAS_NPM_CACHE_URL).toBeUndefined();
    expect(env.EAS_NODEJS_CACHE_URL).toBeUndefined();
    expect(env.EAS_MAVEN_CACHE_URL).toBeUndefined();
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

function mockProcessPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
