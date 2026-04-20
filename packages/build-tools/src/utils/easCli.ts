import spawn, { SpawnOptions, SpawnResult } from '@expo/turtle-spawn';
import { EasCliNpmTags, Env } from '@expo/eas-build-job';

import { isAtLeastNpm7Async } from './packageManager';

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
    return {
      cmd: 'npx',
      args: [...npxArgsPrefix, `eas-cli@${EasCliNpmTags.STAGING}`],
      extraEnv: {},
    };
  } else if (process.env.ENVIRONMENT === 'staging') {
    return {
      cmd: 'npx',
      args: [...npxArgsPrefix, `eas-cli@${EasCliNpmTags.STAGING}`],
      extraEnv: { EXPO_STAGING: '1' },
    };
  } else {
    return {
      cmd: 'npx',
      args: [...npxArgsPrefix, `eas-cli@${EasCliNpmTags.PRODUCTION}`],
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
