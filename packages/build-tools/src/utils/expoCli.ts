// See: `eas-cli/src/utils/expoCli.ts`

import resolveFrom from 'resolve-from';
import spawnAsync from '@expo/spawn-async';

export async function expoCommandAsync(
  projectDir: string,
  args: string[],
  options: Omit<spawnAsync.SpawnOptions, 'cwd'>
) {
  const expoCliPath =
    resolveFrom.silent(projectDir, 'expo/bin/cli') ?? resolveFrom(projectDir, 'expo/bin/cli.js');
  return spawnAsync(expoCliPath, args, {
    cwd: projectDir,
    stdio: 'pipe',
    env: {
      ...options.env,
      EXPO_DEBUG: '0',
    },
    ...options,
  });
}
