import fetch from 'node-fetch';
import { z } from 'zod';

import { Environment } from './constants';

const RUNTIME_SETTINGS_GCS_BUCKETS = {
  [Environment.STAGING]: 'eas-workflows-staging',
  [Environment.PRODUCTION]: 'eas-workflows-production',
} as const;
const RUNTIME_SETTINGS_FILENAME = 'runtime-settings.json';

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

let runtimeSettings = DEFAULT_RUNTIME_SETTINGS;

type Logger = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
};

export function getRuntimeSettingsUrl(environment: Environment): string | null {
  if (environment !== Environment.STAGING && environment !== Environment.PRODUCTION) {
    return null;
  }

  return `https://storage.googleapis.com/${RUNTIME_SETTINGS_GCS_BUCKETS[environment]}/${RUNTIME_SETTINGS_FILENAME}`;
}

export async function loadRuntimeSettingsAsync(
  environment: Environment,
  logger: Logger
): Promise<RuntimeSettings> {
  const url = getRuntimeSettingsUrl(environment);
  if (!url) {
    applyRuntimeSettings(DEFAULT_RUNTIME_SETTINGS);
    return runtimeSettings;
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
      return runtimeSettings;
    }

    const settings = parseRuntimeSettings(await response.json());
    applyRuntimeSettings(settings);
    logger.info({ url, settings }, 'Loaded worker runtime settings');
    return runtimeSettings;
  } catch (err) {
    logger.warn({ err, url }, 'Failed to load worker runtime settings, using defaults');
    applyRuntimeSettings(DEFAULT_RUNTIME_SETTINGS);
    return runtimeSettings;
  }
}

export function parseRuntimeSettings(value: unknown): RuntimeSettings {
  return RuntimeSettingsSchema.parse(value);
}

export function applyRuntimeSettings(settings: RuntimeSettings): void {
  runtimeSettings = settings;
}

export function resetRuntimeSettings(): void {
  runtimeSettings = DEFAULT_RUNTIME_SETTINGS;
}

export function getRuntimeSettings(): RuntimeSettings {
  return runtimeSettings;
}

export function shouldUseCache(
  cacheName: RuntimeSettingsCacheName,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform === 'darwin') {
    if (cacheName === 'maven') {
      return false;
    }
    return runtimeSettings.caches.darwin[cacheName];
  }

  if (cacheName === 'cocoapods') {
    return false;
  }
  return runtimeSettings.caches.linux[cacheName];
}
