import spawn, { SpawnOptions, SpawnResult } from '@expo/turtle-spawn';
import { EasCliNpmTags, EasCliVersions, Env, fetchEasCliVersionsAsync } from '@expo/eas-build-job';

import { isAtLeastNpm7Async } from './packageManager';

/**
 * Resolves the `eas-cli` versions to install for staging/production. Prefers the
 * versions committed to `cli-versions.json` (fetched from expo/eas-cli); on any
 * failure falls back to the `latest-eas-build*` npm dist-tags.
 */
async function resolveEasCliVersionsAsync(): Promise<EasCliVersions> {
  try {
    return await fetchEasCliVersionsAsync();
  } catch {
    return { STAGING: EasCliNpmTags.STAGING, PRODUCTION: EasCliNpmTags.PRODUCTION };
  }
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
  const versions = await resolveEasCliVersionsAsync();
  if (process.env.ENVIRONMENT === 'development') {
    if (await probeEasdAsync()) {
      return { cmd: 'easd', args: [], extraEnv: {} };
    }
    return {
      cmd: 'npx',
      args: [...npxArgsPrefix, `eas-cli@${versions.STAGING}`],
      extraEnv: {},
    };
  } else if (process.env.ENVIRONMENT === 'staging') {
    return {
      cmd: 'npx',
      args: [...npxArgsPrefix, `eas-cli@${versions.STAGING}`],
      extraEnv: { EXPO_STAGING: '1' },
    };
  } else {
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
