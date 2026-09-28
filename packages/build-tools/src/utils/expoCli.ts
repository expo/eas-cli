import resolveFrom from 'resolve-from';
import spawnAsync, { type SpawnOptions } from '@expo/turtle-spawn';

import { type EnvMode, getExpoCommandEnv } from './environmentMode';

export class ExpoCLIModuleNotFoundError extends Error {}

function resolveExpoCLI(projectRoot: string): string {
  try {
    return (
      resolveFrom.silent(projectRoot, 'expo/bin/cli') ?? resolveFrom(projectRoot, 'expo/bin/cli.js')
    );
  } catch (e: any) {
    if (e.code === 'MODULE_NOT_FOUND') {
      throw new ExpoCLIModuleNotFoundError(`The \`expo\` package was not found.`);
    }
    throw e;
  }
}

export async function expoCommandAsync(
  projectDir: string,
  args: string[],
  options: Omit<SpawnOptions, 'cwd'> & { envMode?: EnvMode }
) {
  const expoCliPath = resolveExpoCLI(projectDir);
  const { envMode, ...spawnOptions } = options;
  return spawnAsync(expoCliPath, args, {
    cwd: projectDir,
    stdio: 'pipe',
    ...spawnOptions,
    env: {
      ...(envMode ? getExpoCommandEnv(options.env ?? {}, envMode) : options.env),
      // NOTE: If we're reading user configs, if a user has set this, it might cause excessive output
      // that can stop the command from being readable
      EXPO_DEBUG: '0',
    },
  });
}
