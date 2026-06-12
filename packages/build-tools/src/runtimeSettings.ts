import { Env } from '@expo/eas-build-job';
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
let runtimeEnvironment: Env = {};

export namespace RuntimeSettings {
  export async function loadAsync({
    environment,
    env: nextRuntimeEnvironment = {},
  }: {
    environment: string;
    env?: Env;
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
    } catch (err) {
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
    const runtimeEnabled = runtimeSettings.caches?.[process.platform]?.npm;
    if (runtimeEnabled === false) {
      return null;
    }
    const envOverride = runtimeEnvironment['EAS_USE_NPM_CACHE'];
    const enabled = envOverride === '1' || (envOverride !== '0' && runtimeEnabled);
    return enabled ? process.env.EAS_NPM_CACHE_URL || null : null;
  }

  export function getNodeJsCacheUrl(): string | null {
    const runtimeEnabled = runtimeSettings.caches?.[process.platform]?.nodejs;
    if (runtimeEnabled === false) {
      return null;
    }
    const envOverride = runtimeEnvironment['EAS_USE_NODEJS_CACHE'];
    const enabled = envOverride === '1' || (envOverride !== '0' && runtimeEnabled);
    return enabled ? process.env.EAS_NODEJS_CACHE_URL || null : null;
  }

  export function getMavenCacheUrl(): string | null {
    const runtimeEnabled = runtimeSettings.caches?.[process.platform]?.maven;
    if (runtimeEnabled === false) {
      return null;
    }
    const envOverride = runtimeEnvironment['EAS_USE_MAVEN_CACHE'];
    const enabled = envOverride === '1' || (envOverride !== '0' && runtimeEnabled);
    return enabled ? process.env.EAS_MAVEN_CACHE_URL || null : null;
  }

  export function getCocoapodsCacheUrl(): string | null {
    const runtimeEnabled = runtimeSettings.caches?.[process.platform]?.cocoapods;
    if (runtimeEnabled === false) {
      return null;
    }
    const envOverride = runtimeEnvironment['EAS_USE_COCOAPODS_CACHE'];
    const enabled = envOverride === '1' || (envOverride !== '0' && runtimeEnabled);
    return enabled ? process.env.EAS_COCOAPODS_CACHE_URL || null : null;
  }
}
