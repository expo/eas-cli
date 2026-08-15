import {
  RuntimeSettings,
  XCODE_CCACHE_COMPILER_LAUNCHER_ENV,
  XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV,
} from '@expo/build-tools';
import { Platform, Workflow } from '@expo/eas-build-job';
import { spawnSync } from 'child_process';
import os from 'os';
import v8 from 'v8';

import config from '../config';
import { getBuildEnv, getGradleMemoryOptions, getNodeMemoryOptions } from '../env';

jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}));

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
    NODE_OPTIONS: process.env.NODE_OPTIONS,
  };

  beforeEach(() => {
    jest.mocked(spawnSync).mockImplementation((command: any) => {
      if (command === 'command -v ccache') {
        return { stdout: Buffer.from('/opt/homebrew/bin/ccache\n') } as any;
      }
      if (command === 'xcodebuild') {
        return { stdout: Buffer.from('Xcode 26.6\nBuild version 17F113\n') } as any;
      }
      return { stdout: Buffer.alloc(0) } as any;
    });
    delete process.env.EAS_BUILD_NPM_CACHE_URL;
    delete process.env.NPM_CACHE_URL;
    delete process.env.NVM_NODEJS_ORG_MIRROR;
    delete process.env.EAS_BUILD_MAVEN_CACHE_URL;
    delete process.env.EAS_BUILD_COCOAPODS_CACHE_URL;
    delete process.env.NPM_CONFIG_REGISTRY;
    delete process.env.NODE_OPTIONS;
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
    restoreEnv('NODE_OPTIONS', originalCacheUrls.NODE_OPTIONS);
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

  it('uses the React Native ccache wrapper by default', () => {
    const env = getBuildEnv({
      job: createIosCacheJob(),
      projectId: 'project-id',
      metadata: createMetadata(),
      buildId: 'build-id',
    });

    expect(env.USE_CCACHE).toBe('1');
    expect(env.CCACHE_BINARY).toBe('/opt/homebrew/bin/ccache');
    expect(env[XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV]).toBeUndefined();
  });

  it('selects the Xcode compiler launcher for an opted-in Xcode 26 build', () => {
    const env = getBuildEnv({
      job: createIosCacheJob({ [XCODE_CCACHE_COMPILER_LAUNCHER_ENV]: '1' }),
      projectId: 'project-id',
      metadata: createMetadata(),
      buildId: 'build-id',
    });

    expect(env.USE_CCACHE).toBeUndefined();
    expect(env.CCACHE_BINARY).toBe('/opt/homebrew/bin/ccache');
    expect(env[XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV]).toBe('1');
  });

  it('keeps the React Native ccache wrapper on Xcode 25', () => {
    jest.mocked(spawnSync).mockImplementation((command: any) => {
      if (command === 'command -v ccache') {
        return { stdout: Buffer.from('/opt/homebrew/bin/ccache\n') } as any;
      }
      return { stdout: Buffer.from('Xcode 25.4\nBuild version 16F6\n') } as any;
    });

    const env = getBuildEnv({
      job: createIosCacheJob({ [XCODE_CCACHE_COMPILER_LAUNCHER_ENV]: '1' }),
      projectId: 'project-id',
      metadata: createMetadata(),
      buildId: 'build-id',
    });

    expect(env.USE_CCACHE).toBe('1');
    expect(env[XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV]).toBeUndefined();
  });

  it('keeps the React Native ccache wrapper when ccache is missing', () => {
    jest.mocked(spawnSync).mockReturnValue({ stdout: Buffer.alloc(0) } as any);

    const env = getBuildEnv({
      job: createIosCacheJob({ [XCODE_CCACHE_COMPILER_LAUNCHER_ENV]: '1' }),
      projectId: 'project-id',
      metadata: createMetadata(),
      buildId: 'build-id',
    });

    expect(env.USE_CCACHE).toBe('1');
    expect(env.CCACHE_BINARY).toBeUndefined();
    expect(env[XCODE_CCACHE_COMPILER_LAUNCHER_SUPPORTED_ENV]).toBeUndefined();
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

    expect(env.NPM_CACHE_URL).toBeUndefined();
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

  it('increases the Node.js heap limit on workers with enough memory', () => {
    jest.spyOn(process, 'constrainedMemory').mockReturnValue(6 * 1024 ** 3);
    jest.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      heap_size_limit: 2 * 1024 ** 3,
    } as ReturnType<typeof v8.getHeapStatistics>);

    expect(getNodeMemoryOptions()).toBe('--max-old-space-size=3072');
  });

  it('does not increase the Node.js heap limit on workers with less than 6 GiB of memory', () => {
    jest.spyOn(process, 'constrainedMemory').mockReturnValue(6 * 1024 ** 3 - 1);
    jest.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      heap_size_limit: 2 * 1024 ** 3,
    } as ReturnType<typeof v8.getHeapStatistics>);

    expect(getNodeMemoryOptions()).toBeUndefined();
  });

  it('does not increase an existing Node.js heap limit of at least 3 GiB', () => {
    jest.spyOn(process, 'constrainedMemory').mockReturnValue(6 * 1024 ** 3);
    jest.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      heap_size_limit: 3 * 1024 ** 3,
    } as ReturnType<typeof v8.getHeapStatistics>);

    expect(getNodeMemoryOptions()).toBeUndefined();
  });

  it('keeps Node.js options inherited from the worker environment in override position', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=2048 --enable-source-maps';
    jest.spyOn(process, 'constrainedMemory').mockReturnValue(6 * 1024 ** 3);
    jest.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      heap_size_limit: 2 * 1024 ** 3,
    } as ReturnType<typeof v8.getHeapStatistics>);

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

    expect(env.NODE_OPTIONS).toBe(
      '--max-old-space-size=3072 --max-old-space-size=2048 --enable-source-maps'
    );
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

function createIosCacheJob(extraEnv: Record<string, string> = {}): any {
  return {
    platform: Platform.IOS,
    type: Workflow.GENERIC,
    builderEnvironment: {
      env: {
        EAS_USE_CACHE: '1',
        ...extraEnv,
      },
    },
  };
}

function createMetadata(): any {
  return {
    buildProfile: 'production',
    gitCommitHash: 'abc123',
    username: 'expo-user',
  };
}
