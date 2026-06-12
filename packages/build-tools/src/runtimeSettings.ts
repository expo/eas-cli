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

type RuntimeEnvironment = Record<string, string | undefined>;

let runtimeSettings: z.infer<typeof RuntimeSettingsSchema> = {};
let runtimeEnvironment: RuntimeEnvironment = {};

export namespace RuntimeSettings {
  export async function loadAsync({
    environment,
    logger,
    env: nextRuntimeEnvironment = {},
  }: {
    environment: string;
    logger: bunyan;
    env?: RuntimeEnvironment;
  }): Promise<void> {
    runtimeEnvironment = nextRuntimeEnvironment;
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
    return getCacheUrl('npm', 'EAS_NPM_CACHE_URL', 'EAS_USE_NPM_CACHE');
  }

  export function getNodeJsCacheUrl(): string | null {
    return getCacheUrl('nodejs', 'EAS_NODEJS_CACHE_URL', 'EAS_USE_NODEJS_CACHE');
  }

  export function getMavenCacheUrl(): string | null {
    return getCacheUrl('maven', 'EAS_MAVEN_CACHE_URL', 'EAS_USE_MAVEN_CACHE');
  }

  export function getCocoapodsCacheUrl(): string | null {
    return getCacheUrl('cocoapods', 'EAS_COCOAPODS_CACHE_URL', 'EAS_USE_COCOAPODS_CACHE');
  }
}

function getCacheUrl(
  cacheName: keyof NonNullable<z.infer<typeof RuntimeSettingsSchema>['caches']>[string],
  urlEnvName: string,
  enabledEnvName: string
): string | null {
  const envOverride = runtimeEnvironment[enabledEnvName];
  const enabled =
    envOverride === '1' ||
    (envOverride !== '0' && runtimeSettings.caches?.[process.platform]?.[cacheName]);

  if (!enabled) {
    return null;
  }
  return process.env[urlEnvName] || null;
}
