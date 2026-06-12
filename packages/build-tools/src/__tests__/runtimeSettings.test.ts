import fetch from 'node-fetch';

import { RuntimeSettings } from '../runtimeSettings';
import { Sentry } from '../sentry';

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../sentry', () => ({
  Sentry: {
    capture: jest.fn(),
  },
}));

describe('runtimeSettings', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };
  const originalCacheUrls = {
    EAS_NPM_CACHE_URL: process.env.EAS_NPM_CACHE_URL,
    EAS_NODEJS_CACHE_URL: process.env.EAS_NODEJS_CACHE_URL,
    EAS_MAVEN_CACHE_URL: process.env.EAS_MAVEN_CACHE_URL,
    EAS_COCOAPODS_CACHE_URL: process.env.EAS_COCOAPODS_CACHE_URL,
  };
  const originalPlatform = process.platform;

  afterEach(() => {
    jest.mocked(fetch).mockReset();
    jest.restoreAllMocks();
    jest.mocked(Sentry.capture).mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
    restoreEnv('EAS_NPM_CACHE_URL', originalCacheUrls.EAS_NPM_CACHE_URL);
    restoreEnv('EAS_NODEJS_CACHE_URL', originalCacheUrls.EAS_NODEJS_CACHE_URL);
    restoreEnv('EAS_MAVEN_CACHE_URL', originalCacheUrls.EAS_MAVEN_CACHE_URL);
    restoreEnv('EAS_COCOAPODS_CACHE_URL', originalCacheUrls.EAS_COCOAPODS_CACHE_URL);
    mockProcessPlatform(originalPlatform);
  });

  beforeEach(async () => {
    jest.mocked(fetch).mockResolvedValue(response({}));
    await RuntimeSettings.loadAsync({ environment: 'staging', logger: logger as any });
    jest.mocked(fetch).mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  it('fetches runtime settings from the staging and production buckets', async () => {
    jest.mocked(fetch).mockResolvedValue(response({}));

    await RuntimeSettings.loadAsync({ environment: 'staging', logger: logger as any });
    await RuntimeSettings.loadAsync({ environment: 'production', logger: logger as any });
    await RuntimeSettings.loadAsync({ environment: 'test', logger: logger as any });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://storage.googleapis.com/eas-workflows-staging/runtime-settings.json',
      {
        signal: expect.anything(),
      }
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://storage.googleapis.com/eas-workflows-production/runtime-settings.json',
      {
        signal: expect.anything(),
      }
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not use caches by default when remote settings are unavailable', async () => {
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';
    jest.mocked(fetch).mockResolvedValue(response({}, 404));

    await RuntimeSettings.loadAsync({ environment: 'staging', logger: logger as any });

    mockProcessPlatform('linux');
    expect(RuntimeSettings.getNpmCacheUrl()).toBeNull();
    expect(RuntimeSettings.isUsingIosPrecompiledModulesEnabled()).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(Sentry.capture).toHaveBeenCalledWith('Failed to fetch worker runtime settings', {
      extras: {
        status: 404,
        url: 'https://storage.googleapis.com/eas-workflows-staging/runtime-settings.json',
      },
      level: 'warning',
    });
  });

  it('does not override existing settings when remote settings are invalid', async () => {
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(response({ caches: { linux: { npm: true } } }))
      .mockResolvedValueOnce(response({ iosPrecompiledModules: 'enabled' }));

    await RuntimeSettings.loadAsync({ environment: 'staging', logger: logger as any });
    await RuntimeSettings.loadAsync({ environment: 'staging', logger: logger as any });

    mockProcessPlatform('linux');
    expect(RuntimeSettings.getNpmCacheUrl()).toBe('https://npm.example');
    expect(RuntimeSettings.isUsingIosPrecompiledModulesEnabled()).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Failed to load worker runtime settings',
      expect.any(Error),
      {
        extras: {
          url: 'https://storage.googleapis.com/eas-workflows-staging/runtime-settings.json',
        },
        level: 'warning',
      }
    );
  });

  it('accepts partial runtime settings and ignores unknown fields', async () => {
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';
    process.env.EAS_NODEJS_CACHE_URL = 'https://node.example';
    process.env.EAS_MAVEN_CACHE_URL = 'https://maven.example';
    process.env.EAS_COCOAPODS_CACHE_URL = 'https://pods.example';
    jest.mocked(fetch).mockResolvedValue(
      response({
        caches: {
          linux: { npm: false, nodejs: true, maven: true },
          darwin: { npm: true, maven: true, cocoapods: false },
        },
        iosPrecompiledModules: true,
        unknownFutureSetting: true,
      })
    );

    await RuntimeSettings.loadAsync({ environment: 'staging', logger: logger as any });

    mockProcessPlatform('linux');
    expect(RuntimeSettings.getNpmCacheUrl()).toBeNull();
    expect(RuntimeSettings.getNodeJsCacheUrl()).toBe('https://node.example');
    expect(RuntimeSettings.getMavenCacheUrl()).toBe('https://maven.example');
    mockProcessPlatform('darwin');
    expect(RuntimeSettings.getMavenCacheUrl()).toBe('https://maven.example');
    expect(RuntimeSettings.getCocoapodsCacheUrl()).toBeNull();
    expect(RuntimeSettings.getNpmCacheUrl()).toBe('https://npm.example');
    expect(RuntimeSettings.isUsingIosPrecompiledModulesEnabled()).toBe(true);
  });

  it('uses Maven and CocoaPods caches when enabled for the current platform and their environment variables exist', async () => {
    process.env.EAS_MAVEN_CACHE_URL = 'https://maven.example';
    process.env.EAS_COCOAPODS_CACHE_URL = 'https://pods.example';
    jest.mocked(fetch).mockResolvedValue(
      response({
        caches: {
          linux: { maven: true },
          darwin: { maven: true, cocoapods: true },
        },
      })
    );

    await RuntimeSettings.loadAsync({ environment: 'staging', logger: logger as any });

    mockProcessPlatform('linux');
    expect(RuntimeSettings.getMavenCacheUrl()).toBe('https://maven.example');
    mockProcessPlatform('darwin');
    expect(RuntimeSettings.getMavenCacheUrl()).toBe('https://maven.example');
    expect(RuntimeSettings.getCocoapodsCacheUrl()).toBe('https://pods.example');
  });

  it('uses job environment flags to enable cache URLs from worker environment variables', async () => {
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';

    await RuntimeSettings.loadAsync({
      environment: 'test',
      logger: logger as any,
      env: {
        EAS_USE_NPM_CACHE: '1',
      },
    });

    mockProcessPlatform('linux');
    expect(RuntimeSettings.getNpmCacheUrl()).toBe('https://npm.example');
  });

  it('returns null when job env enables cache but worker env var is empty', async () => {
    process.env.EAS_NPM_CACHE_URL = '';

    await RuntimeSettings.loadAsync({
      environment: 'test',
      logger: logger as any,
      env: {
        EAS_USE_NPM_CACHE: '1',
      },
    });

    mockProcessPlatform('linux');
    expect(RuntimeSettings.getNpmCacheUrl()).toBeNull();
  });

  it('does not use cache URLs from the job environment', async () => {
    await RuntimeSettings.loadAsync({
      environment: 'test',
      logger: logger as any,
      env: {
        EAS_USE_NPM_CACHE: '1',
        EAS_NPM_CACHE_URL: 'https://job-npm.example',
      },
    });

    mockProcessPlatform('linux');
    expect(RuntimeSettings.getNpmCacheUrl()).toBeNull();
  });

  it('allows job environment flags to disable remotely enabled cache URLs', async () => {
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';
    jest.mocked(fetch).mockResolvedValue(response({ caches: { linux: { npm: true } } }));

    await RuntimeSettings.loadAsync({
      environment: 'staging',
      logger: logger as any,
      env: {
        EAS_USE_NPM_CACHE: '0',
      },
    });

    mockProcessPlatform('linux');
    expect(RuntimeSettings.getNpmCacheUrl()).toBeNull();
  });

  it('does not use caches when runtime settings are not loaded', () => {
    process.env.EAS_NPM_CACHE_URL = 'https://npm.example';

    jest.isolateModules(() => {
      const { RuntimeSettings } = require('../runtimeSettings');

      expect(RuntimeSettings.getNpmCacheUrl()).toBeNull();
      expect(RuntimeSettings.isUsingIosPrecompiledModulesEnabled()).toBe(false);
    });
  });

  it('reports when loaded runtime settings omit the current platform cache settings', async () => {
    jest.mocked(fetch).mockResolvedValue(response({ caches: { linux: { npm: true } } }));
    mockProcessPlatform('darwin');

    await RuntimeSettings.loadAsync({ environment: 'staging', logger: logger as any });

    expect(RuntimeSettings.getNpmCacheUrl()).toBeNull();
    expect(Sentry.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Runtime settings are missing cache settings for platform "darwin"',
      }),
      {
        extras: {
          configuredPlatforms: ['linux'],
          platform: 'darwin',
        },
        level: 'error',
      }
    );
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function mockProcessPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

function response(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
