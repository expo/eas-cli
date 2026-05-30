import fetch from 'node-fetch';
import { z } from 'zod';

import { Environment } from './constants';

const RUNTIME_SETTINGS_FILENAME = 'runtime-settings.json';

const CACHE_URL_ENV_VARS = {
  npm: ['EAS_BUILD_NPM_CACHE_URL', 'NPM_CACHE_URL'],
  nodejs: ['NVM_NODEJS_ORG_MIRROR'],
  maven: ['EAS_BUILD_MAVEN_CACHE_URL'],
  cocoapods: ['EAS_BUILD_COCOAPODS_CACHE_URL'],
} as const satisfies Record<RuntimeSettingsCacheName, readonly string[]>;

export const RuntimeSettingsSchema = z
  .object({
    caches: z
      .object({
        linux: z
          .object({
            npm: z.boolean(),
            nodejs: z.boolean(),
            maven: z.boolean(),
          })
          .strict(),
        darwin: z
          .object({
            npm: z.boolean(),
            nodejs: z.boolean(),
            cocoapods: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    iosPrecompiledModules: z.boolean(),
  })
  .strict();

export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;
export type RuntimeSettingsCacheName = 'npm' | 'nodejs' | 'maven' | 'cocoapods';
export type RuntimeSettingsCacheUrlEnvVar =
  (typeof CACHE_URL_ENV_VARS)[RuntimeSettingsCacheName][number];

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  caches: {
    linux: {
      npm: true,
      nodejs: true,
      maven: true,
    },
    darwin: {
      npm: true,
      nodejs: true,
      cocoapods: true,
    },
  },
  iosPrecompiledModules: false,
};

let runtimeSettings: RuntimeSettings | null = null;

type Logger = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
};

export function getRuntimeSettingsUrl(environment: Environment): string | null {
  if (environment !== Environment.STAGING && environment !== Environment.PRODUCTION) {
    return null;
  }

  return `https://storage.googleapis.com/eas-workflows-${environment}/${RUNTIME_SETTINGS_FILENAME}`;
}

export async function loadRuntimeSettingsAsync(
  environment: Environment,
  logger: Logger
): Promise<RuntimeSettings> {
  const url = getRuntimeSettingsUrl(environment);
  if (!url) {
    applyRuntimeSettings(DEFAULT_RUNTIME_SETTINGS);
    return getRuntimeSettings();
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn(
        { url, status: response.status },
        'Failed to fetch worker runtime settings, using defaults'
      );
      applyRuntimeSettings(DEFAULT_RUNTIME_SETTINGS);
      return getRuntimeSettings();
    }

    const settings = parseRuntimeSettings(await response.json());
    applyRuntimeSettings(settings);
    logger.info({ url, settings }, 'Loaded worker runtime settings');
    return getRuntimeSettings();
  } catch (err) {
    logger.warn({ err, url }, 'Failed to load worker runtime settings, using defaults');
    applyRuntimeSettings(DEFAULT_RUNTIME_SETTINGS);
    return getRuntimeSettings();
  }
}

export function parseRuntimeSettings(value: unknown): RuntimeSettings {
  return RuntimeSettingsSchema.parse(value);
}

export function applyRuntimeSettings(settings: RuntimeSettings): void {
  runtimeSettings = settings;
}

export function resetRuntimeSettings(): void {
  runtimeSettings = null;
}

export function getRuntimeSettings(): RuntimeSettings {
  if (!runtimeSettings) {
    throw new Error('Runtime settings must be loaded before use');
  }
  return runtimeSettings;
}

export function shouldUseCache(
  cacheName: RuntimeSettingsCacheName,
  platform: NodeJS.Platform = process.platform
): boolean {
  const settings = getRuntimeSettings();
  if (platform === 'darwin') {
    if (cacheName === 'maven') {
      return false;
    }
    return settings.caches.darwin[cacheName];
  }

  if (cacheName === 'cocoapods') {
    return false;
  }
  return settings.caches.linux[cacheName];
}

export function getRuntimeSettingsCacheUrl(
  cacheName: RuntimeSettingsCacheName,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!shouldUseCache(cacheName, platform)) {
    return null;
  }

  for (const envVar of CACHE_URL_ENV_VARS[cacheName]) {
    const value = process.env[envVar];
    if (value) {
      return value;
    }
  }

  return null;
}

export function getRuntimeSettingsCacheUrlEnvVars(): RuntimeSettingsCacheUrlEnvVar[] {
  return Object.values(CACHE_URL_ENV_VARS).flat();
}
