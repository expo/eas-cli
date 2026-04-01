import resolveFrom from 'resolve-from';
import spawnAsync, { type SpawnOptions } from '@expo/turtle-spawn';

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
  options: Omit<SpawnOptions, 'cwd'>
) {
  const expoCliPath = resolveExpoCLI(projectDir);
  return spawnAsync(expoCliPath, args, {
    cwd: projectDir,
    stdio: 'pipe',
    ...options,
    env: {
      ...options.env,
      // NOTE: If we're reading user configs, if a user has set this, it might cause excessive output
      // that can stop the command from being readable
      EXPO_DEBUG: '0',
    },
  });
}
