import spawn, { SpawnOptions, SpawnResult } from '@expo/turtle-spawn';
import {
  EasCliNpmTags,
  EasCliVersions,
  EasCliVersionsFetchTimeoutError,
  Env,
  fetchEasCliVersionsAsync,
} from '@expo/eas-build-job';

import { isAtLeastNpm7Async } from './packageManager';
import { Sentry } from '../sentry';

let cachedEasCliVersionsPromise: Promise<EasCliVersions> | undefined;

/**
 * Resolves the `eas-cli` versions to install for staging/production. Prefers the
 * versions committed to `cli-versions.json` (fetched from expo/eas-cli); on any
 * failure (e.g. GitHub is unreachable or slow) reports to Sentry and falls back
 * to the `latest-eas-build*` npm dist-tags so the build can still proceed.
 *
 * Memoized: `resolveEasCommandPrefixAndEnvAsync` runs more than once per build,
 * so the (never-rejecting) result promise is cached to fetch GitHub at most once
 * per process.
 */
async function resolveEasCliVersionsAsync(): Promise<EasCliVersions> {
  if (!cachedEasCliVersionsPromise) {
    cachedEasCliVersionsPromise = fetchEasCliVersionsWithFallbackAsync();
  }
  return await cachedEasCliVersionsPromise;
}

async function fetchEasCliVersionsWithFallbackAsync(): Promise<EasCliVersions> {
  try {
    return await fetchEasCliVersionsAsync();
  } catch (error) {
    const message =
      error instanceof EasCliVersionsFetchTimeoutError
        ? 'Timed out fetching cli-versions.json; falling back to npm dist-tags'
        : 'Failed to fetch cli-versions.json; falling back to npm dist-tags';
    Sentry.capture(message, error instanceof Error ? error : new Error(String(error)), {
      level: 'warning',
    });
    return { STAGING: EasCliNpmTags.STAGING, PRODUCTION: EasCliNpmTags.PRODUCTION };
  }
}

/** Test-only: clears the memoized versions promise so each test fetches fresh. */
export function resetCachedEasCliVersionsForTest(): void {
  cachedEasCliVersionsPromise = undefined;
}

async function probeEasdAsync(): Promise<boolean> {
  try {
    const result = await spawn('easd', ['--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export async function resolveEasCommandPrefixAndEnvAsync(): Promise<{
  cmd: string;
  args: string[];
  extraEnv: Env;
}> {
  const npxArgsPrefix = (await isAtLeastNpm7Async()) ? ['-y'] : [];
  if (process.env.ENVIRONMENT === 'development') {
    if (await probeEasdAsync()) {
      return { cmd: 'easd', args: [], extraEnv: {} };
    }
    const versions = await resolveEasCliVersionsAsync();
    return {
      cmd: 'npx',
      args: [...npxArgsPrefix, `eas-cli@${versions.STAGING}`],
      extraEnv: {},
    };
  } else if (process.env.ENVIRONMENT === 'staging') {
    const versions = await resolveEasCliVersionsAsync();
    return {
      cmd: 'npx',
      args: [...npxArgsPrefix, `eas-cli@${versions.STAGING}`],
      extraEnv: { EXPO_STAGING: '1' },
    };
  } else {
    const versions = await resolveEasCliVersionsAsync();
    return {
      cmd: 'npx',
      args: [...npxArgsPrefix, `eas-cli@${versions.PRODUCTION}`],
      extraEnv: {},
    };
  }
}

export async function runEasCliCommand({
  args,
  options,
}: {
  args: string[];
  options: SpawnOptions;
}): Promise<SpawnResult> {
  const { logger, ...spawnOptions } = options;
  const { cmd, args: commandPrefixArgs, extraEnv } = await resolveEasCommandPrefixAndEnvAsync();
  return await spawn(cmd, [...commandPrefixArgs, ...args], {
    ...spawnOptions,
    logger,
    env: { ...spawnOptions.env, ...extraEnv },
  });
}
