import { Response } from 'node-fetch';
import fetch from 'node-fetch';

import { Environment } from '../constants';
import {
  DEFAULT_RUNTIME_SETTINGS,
  applyRuntimeSettings,
  getRuntimeSettings,
  getRuntimeSettingsUrl,
  loadRuntimeSettingsAsync,
  parseRuntimeSettings,
  resetRuntimeSettings,
  shouldUseCache,
} from '../runtimeSettings';

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

  afterEach(() => {
    resetRuntimeSettings();
    jest.mocked(fetch).mockReset();
    jest.restoreAllMocks();
  });

  it('resolves hardcoded GCS URLs for staging and production only', () => {
    expect(getRuntimeSettingsUrl(Environment.STAGING)).toBe(
      'https://storage.googleapis.com/eas-workflows-staging/runtime-settings.json'
    );
    expect(getRuntimeSettingsUrl(Environment.PRODUCTION)).toBe(
      'https://storage.googleapis.com/eas-workflows-production/runtime-settings.json'
    );
    expect(getRuntimeSettingsUrl(Environment.DEVELOPMENT)).toBeNull();
    expect(getRuntimeSettingsUrl(Environment.TEST)).toBeNull();
  });

  it('uses defaults when remote settings are unavailable', async () => {
    jest.mocked(fetch).mockResolvedValue(new Response('missing', { status: 404 }));

    await expect(loadRuntimeSettingsAsync(Environment.STAGING, logger)).resolves.toEqual(
      DEFAULT_RUNTIME_SETTINGS
    );
    expect(getRuntimeSettings()).toEqual(DEFAULT_RUNTIME_SETTINGS);
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

    await expect(loadRuntimeSettingsAsync(Environment.STAGING, logger)).resolves.toEqual(
      DEFAULT_RUNTIME_SETTINGS
    );
    expect(getRuntimeSettings()).toEqual(DEFAULT_RUNTIME_SETTINGS);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('validates accepted and rejected runtime settings JSON', () => {
    expect(
      parseRuntimeSettings({
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
      parseRuntimeSettings({
        caches: {
          linux: { npm: true, nodejs: true, maven: true },
          darwin: { npm: true, nodejs: true, cocoapods: true },
        },
        iosPrecompiledModules: 'enabled',
      })
    ).toThrow();
  });

  it('gates caches per worker platform', () => {
    applyRuntimeSettings({
      caches: {
        linux: { npm: false, nodejs: true, maven: false },
        darwin: { npm: true, nodejs: false, cocoapods: false },
      },
      iosPrecompiledModules: false,
    });

    expect(shouldUseCache('npm', 'linux')).toBe(false);
    expect(shouldUseCache('maven', 'linux')).toBe(false);
    expect(shouldUseCache('nodejs', 'linux')).toBe(true);

    expect(shouldUseCache('nodejs', 'darwin')).toBe(false);
    expect(shouldUseCache('cocoapods', 'darwin')).toBe(false);
    expect(shouldUseCache('npm', 'darwin')).toBe(true);
    expect(shouldUseCache('maven', 'darwin')).toBe(false);
    expect(shouldUseCache('cocoapods', 'linux')).toBe(false);
  });
});
