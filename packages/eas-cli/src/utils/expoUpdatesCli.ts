import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import resolveFrom, { silent as silentResolveFrom } from 'resolve-from';

import Log, { link } from '../log';

export async function expoUpdatesCommandAsync(projectDir: string, args: string[]): Promise<string> {
  let expoUpdatesCli;
  try {
    expoUpdatesCli =
      silentResolveFrom(projectDir, 'expo-updates/bin/cli') ??
      resolveFrom(projectDir, 'expo-updates/bin/cli.js');
  } catch (e: any) {
    if (e.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `The \`expo-updates\` package was not found. Follow the installation directions at ${link(
          'https://docs.expo.dev/bare/installing-expo-modules/'
        )}`
      );
    }
    throw e;
  }

  const spawnPromise = spawnAsync(expoUpdatesCli, args, {
    stdio: ['inherit', 'pipe', 'pipe'], // inherit stdin so user can install a missing expo-cli from inside this command
  });
  const {
    child: { stderr },
  } = spawnPromise;
  if (!stderr) {
    throw new Error('Failed to spawn expo-updates cli');
  }
  stderr.on('data', data => {
    for (const line of data.toString().trim().split('\n')) {
      Log.warn(`${chalk.gray('[expo-cli]')} ${line}`);
    }
  });
  const result = await spawnPromise;
  return result.stdout;
}
