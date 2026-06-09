import fetch from 'node-fetch';
import { z } from 'zod';

const RUNTIME_SETTINGS_FILENAME = 'runtime-settings.json';
const RUNTIME_SETTINGS_ENVIRONMENTS = ['staging', 'production'] as const;

const CACHE_URL_ENV_VARS = {
  npm: ['EAS_BUILD_NPM_CACHE_URL', 'NPM_CACHE_URL'],
  nodejs: ['NVM_NODEJS_ORG_MIRROR'],
  maven: ['EAS_BUILD_MAVEN_CACHE_URL'],
  cocoapods: ['EAS_BUILD_COCOAPODS_CACHE_URL'],
} as const satisfies Record<RuntimeSettingsCacheName, readonly string[]>;

const RuntimeSettingsSchema = z
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
type RuntimeSettingsEnvironment = (typeof RUNTIME_SETTINGS_ENVIRONMENTS)[number];
export type RuntimeSettingsCacheName = 'npm' | 'nodejs' | 'maven' | 'cocoapods';
export type RuntimeSettingsCacheUrlEnvVar =
  (typeof CACHE_URL_ENV_VARS)[RuntimeSettingsCacheName][number];

const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
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

function getUrl(environment: string): string | null {
  if (!RUNTIME_SETTINGS_ENVIRONMENTS.includes(environment as RuntimeSettingsEnvironment)) {
    return null;
  }

  return `https://storage.googleapis.com/eas-workflows-${environment}/${RUNTIME_SETTINGS_FILENAME}`;
}

async function loadAsync(environment: string, logger: Logger): Promise<RuntimeSettings> {
  const url = getUrl(environment);
  if (!url) {
    apply(DEFAULT_RUNTIME_SETTINGS);
    return get();
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
      apply(DEFAULT_RUNTIME_SETTINGS);
      return get();
    }

    const settings = parse(await response.json());
    apply(settings);
    logger.info({ url, settings }, 'Loaded worker runtime settings');
    return get();
  } catch (err) {
    logger.warn({ err, url }, 'Failed to load worker runtime settings, using defaults');
    apply(DEFAULT_RUNTIME_SETTINGS);
    return get();
  }
}

function parse(value: unknown): RuntimeSettings {
  return RuntimeSettingsSchema.parse(value);
}

function apply(settings: RuntimeSettings): void {
  runtimeSettings = settings;
}

function reset(): void {
  runtimeSettings = null;
}

function get(): RuntimeSettings {
  if (!runtimeSettings) {
    throw new Error('Runtime settings must be loaded before use');
  }
  return runtimeSettings;
}

function shouldUseCache(
  cacheName: RuntimeSettingsCacheName,
  platform: NodeJS.Platform = process.platform
): boolean {
  const settings = get();
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

function getCacheUrl(
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

function getCacheUrlEnvVars(): RuntimeSettingsCacheUrlEnvVar[] {
  return Object.values(CACHE_URL_ENV_VARS).flat();
}

export const RuntimeSettings = {
  schema: RuntimeSettingsSchema,
  defaultSettings: DEFAULT_RUNTIME_SETTINGS,
  getUrl,
  loadAsync,
  parse,
  apply,
  reset,
  get,
  shouldUseCache,
  getCacheUrl,
  getCacheUrlEnvVars,
};
