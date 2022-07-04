import { default as spawnAsync } from '@expo/spawn-async';
import chalk from 'chalk';
import resolveFrom from 'resolve-from';

import Log from '../log.js';

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
