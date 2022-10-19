import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import { boolish } from 'getenv';
import resolveFrom from 'resolve-from';

import Log from '../log';

export function shouldUseVersionedExpoCLI(projectDir: string): boolean {
  // Users can disable local CLI settings EXPO_USE_LOCAL_CLI=false
  // https://github.com/expo/expo/blob/69eddda7bb1dbfab44258f468cf7f22984c1e44e/packages/expo/bin/cli.js#L10
  return !!resolveFrom.silent(projectDir, '@expo/cli') && boolish('EXPO_USE_LOCAL_CLI', true);
}

export async function expoCommandAsync(
  projectDir: string,
  args: string[],
  { silent = false }: { silent?: boolean } = {}
): Promise<void> {
  const expoCliPath = resolveFrom(projectDir, 'expo/bin/cli.js');
  const spawnPromise = spawnAsync(expoCliPath, args, {
    stdio: ['inherit', 'pipe', 'pipe'], // inherit stdin so user can install a missing expo-cli from inside this command
  });
  const {
    child: { stdout, stderr },
  } = spawnPromise;
  if (!(stdout && stderr)) {
    throw new Error('Failed to spawn expo-cli');
  }
  if (!silent) {
    stdout.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        Log.log(`${chalk.gray('[expo-cli]')} ${line}`);
      }
    });
    stderr.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        Log.warn(`${chalk.gray('[expo-cli]')} ${line}`);
      }
    });
  }
  await spawnPromise;
}
