import { type bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { z } from 'zod';

import { Sentry } from './sentry';

const ENVIRONMENT_TO_RUNTIME_SETTINGS_URL: Record<string, string | undefined> = {
  staging: 'https://storage.googleapis.com/eas-workflows-staging/runtime-settings.json',
  production: 'https://storage.googleapis.com/eas-workflows-production/runtime-settings.json',
};

const RuntimeSettingsSchema = z
  .object({
    caches: z.record(
      z.string(),
      z
        .object({
          npm: z.boolean(),
          nodejs: z.boolean(),
          maven: z.boolean(),
          cocoapods: z.boolean(),
        })
        .partial()
    ),
    iosPrecompiledModules: z.boolean(),
  })
  .partial();

let runtimeSettings: z.infer<typeof RuntimeSettingsSchema> = {};

export namespace RuntimeSettings {
  export async function loadAsync({
    environment,
    logger,
  }: {
    environment: string;
    logger: bunyan;
  }): Promise<void> {
    const url = ENVIRONMENT_TO_RUNTIME_SETTINGS_URL[environment];
    if (!url) {
      return;
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1000),
      });

      if (!response.ok) {
        logger.warn(
          { url, status: response.status },
          'Failed to fetch worker runtime settings, using defaults'
        );
        Sentry.capture('Failed to fetch worker runtime settings', {
          extras: { url, status: response.status },
          level: 'warning',
        });
        return;
      }

      runtimeSettings = RuntimeSettingsSchema.parse(await response.json());
      if (runtimeSettings.caches && !runtimeSettings.caches[process.platform]) {
        Sentry.capture(
          new Error(
            `Runtime settings are missing cache settings for platform "${process.platform}"`
          ),
          {
            extras: {
              configuredPlatforms: Object.keys(runtimeSettings.caches),
              platform: process.platform,
            },
            level: 'error',
          }
        );
      }
      logger.info({ url, settings: runtimeSettings }, 'Loaded worker runtime settings');
    } catch (err) {
      logger.warn({ err, url }, 'Failed to load worker runtime settings, using defaults');
      Sentry.capture(
        'Failed to load worker runtime settings',
        err instanceof Error ? err : new Error(String(err)),
        {
          extras: { url },
          level: 'warning',
        }
      );
    }
  }

  export function isUsingIosPrecompiledModulesEnabled(): boolean {
    return runtimeSettings.iosPrecompiledModules ?? false;
  }

  export function getNpmCacheUrl(): string | null {
    return runtimeSettings.caches?.[process.platform]?.npm
      ? process.env.EAS_NPM_CACHE_URL || null
      : null;
  }

  export function getNodeJsCacheUrl(): string | null {
    return runtimeSettings.caches?.[process.platform]?.nodejs
      ? process.env.EAS_NODEJS_CACHE_URL || null
      : null;
  }

  export function getMavenCacheUrl(): string | null {
    return runtimeSettings.caches?.[process.platform]?.maven
      ? process.env.EAS_MAVEN_CACHE_URL || null
      : null;
  }

  export function getCocoapodsCacheUrl(): string | null {
    return runtimeSettings.caches?.[process.platform]?.cocoapods
      ? process.env.EAS_COCOAPODS_CACHE_URL || null
      : null;
  }
}
