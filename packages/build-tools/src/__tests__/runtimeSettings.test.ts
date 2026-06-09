import { Response } from 'node-fetch';
import fetch from 'node-fetch';

import { RuntimeSettings } from '../runtimeSettings';

jest.mock('node-fetch', () => {
  const actual = jest.requireActual('node-fetch');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn(),
  };
});

describe('runtimeSettings', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };
  const originalCacheUrls = {
    EAS_BUILD_NPM_CACHE_URL: process.env.EAS_BUILD_NPM_CACHE_URL,
    NPM_CACHE_URL: process.env.NPM_CACHE_URL,
    NVM_NODEJS_ORG_MIRROR: process.env.NVM_NODEJS_ORG_MIRROR,
    EAS_BUILD_MAVEN_CACHE_URL: process.env.EAS_BUILD_MAVEN_CACHE_URL,
    EAS_BUILD_COCOAPODS_CACHE_URL: process.env.EAS_BUILD_COCOAPODS_CACHE_URL,
  };

  afterEach(() => {
    RuntimeSettings.reset();
    jest.mocked(fetch).mockReset();
    jest.restoreAllMocks();
    restoreEnv('EAS_BUILD_NPM_CACHE_URL', originalCacheUrls.EAS_BUILD_NPM_CACHE_URL);
    restoreEnv('NPM_CACHE_URL', originalCacheUrls.NPM_CACHE_URL);
    restoreEnv('NVM_NODEJS_ORG_MIRROR', originalCacheUrls.NVM_NODEJS_ORG_MIRROR);
    restoreEnv('EAS_BUILD_MAVEN_CACHE_URL', originalCacheUrls.EAS_BUILD_MAVEN_CACHE_URL);
    restoreEnv('EAS_BUILD_COCOAPODS_CACHE_URL', originalCacheUrls.EAS_BUILD_COCOAPODS_CACHE_URL);
  });

  it('resolves hardcoded GCS URLs for staging and production only', () => {
    expect(RuntimeSettings.getUrl('staging')).toBe(
      'https://storage.googleapis.com/eas-workflows-staging/runtime-settings.json'
    );
    expect(RuntimeSettings.getUrl('production')).toBe(
      'https://storage.googleapis.com/eas-workflows-production/runtime-settings.json'
    );
    expect(RuntimeSettings.getUrl('development')).toBeNull();
    expect(RuntimeSettings.getUrl('test')).toBeNull();
  });

  it('uses defaults when remote settings are unavailable', async () => {
    jest.mocked(fetch).mockResolvedValue(new Response('missing', { status: 404 }));

    await expect(RuntimeSettings.loadAsync('staging', logger)).resolves.toEqual(
      RuntimeSettings.defaultSettings
    );
    expect(RuntimeSettings.get()).toEqual(RuntimeSettings.defaultSettings);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('uses defaults when remote settings are invalid', async () => {
    jest.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          caches: {
            linux: { npm: true, nodejs: true, maven: true, extra: true },
            darwin: { npm: true, nodejs: true, cocoapods: true },
          },
          iosPrecompiledModules: false,
        }),
        { status: 200 }
      )
    );

    await expect(RuntimeSettings.loadAsync('staging', logger)).resolves.toEqual(
      RuntimeSettings.defaultSettings
    );
    expect(RuntimeSettings.get()).toEqual(RuntimeSettings.defaultSettings);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('validates accepted and rejected runtime settings JSON', () => {
    expect(
      RuntimeSettings.parse({
        caches: {
          linux: { npm: true, nodejs: false, maven: true },
          darwin: { npm: true, nodejs: true, cocoapods: false },
        },
        iosPrecompiledModules: true,
      })
    ).toEqual({
      caches: {
        linux: { npm: true, nodejs: false, maven: true },
        darwin: { npm: true, nodejs: true, cocoapods: false },
      },
      iosPrecompiledModules: true,
    });

    expect(() =>
      RuntimeSettings.parse({
        caches: {
          linux: { npm: true, nodejs: true, maven: true },
          darwin: { npm: true, nodejs: true, cocoapods: true },
        },
        iosPrecompiledModules: 'enabled',
      })
    ).toThrow();
  });

  it('gates caches per worker platform', () => {
    RuntimeSettings.apply({
      caches: {
        linux: { npm: false, nodejs: true, maven: false },
        darwin: { npm: true, nodejs: false, cocoapods: false },
      },
      iosPrecompiledModules: false,
    });

    expect(RuntimeSettings.shouldUseCache('npm', 'linux')).toBe(false);
    expect(RuntimeSettings.shouldUseCache('maven', 'linux')).toBe(false);
    expect(RuntimeSettings.shouldUseCache('nodejs', 'linux')).toBe(true);

    expect(RuntimeSettings.shouldUseCache('nodejs', 'darwin')).toBe(false);
    expect(RuntimeSettings.shouldUseCache('cocoapods', 'darwin')).toBe(false);
    expect(RuntimeSettings.shouldUseCache('npm', 'darwin')).toBe(true);
    expect(RuntimeSettings.shouldUseCache('maven', 'darwin')).toBe(false);
    expect(RuntimeSettings.shouldUseCache('cocoapods', 'linux')).toBe(false);
  });

  it('requires runtime settings to be loaded before use', () => {
    RuntimeSettings.reset();

    expect(() => RuntimeSettings.get()).toThrow('Runtime settings must be loaded before use');
    expect(() => RuntimeSettings.shouldUseCache('npm')).toThrow(
      'Runtime settings must be loaded before use'
    );
  });

  it('infers enabled cache URLs from environment variables', () => {
    process.env.EAS_BUILD_NPM_CACHE_URL = 'https://npm.example';
    process.env.NVM_NODEJS_ORG_MIRROR = 'https://node.example';
    process.env.EAS_BUILD_MAVEN_CACHE_URL = 'https://maven.example';
    process.env.EAS_BUILD_COCOAPODS_CACHE_URL = 'https://pods.example';
    RuntimeSettings.apply({
      caches: {
        linux: { npm: true, nodejs: true, maven: false },
        darwin: { npm: false, nodejs: true, cocoapods: true },
      },
      iosPrecompiledModules: false,
    });

    expect(RuntimeSettings.getCacheUrl('npm', 'linux')).toBe('https://npm.example');
    expect(RuntimeSettings.getCacheUrl('nodejs', 'linux')).toBe('https://node.example');
    expect(RuntimeSettings.getCacheUrl('maven', 'linux')).toBeNull();
    expect(RuntimeSettings.getCacheUrl('cocoapods', 'darwin')).toBe('https://pods.example');
    expect(RuntimeSettings.getCacheUrl('npm', 'darwin')).toBeNull();
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
