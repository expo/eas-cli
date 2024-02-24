import spawnAsync from '@expo/spawn-async';
import resolveFrom, { silent as silentResolveFrom } from 'resolve-from';

import { link } from '../log';

export class ExpoUpdatesCLIModuleNotFoundError extends Error {}
export class ExpoUpdatesCLIInvalidCommandError extends Error {}

export async function expoUpdatesCommandAsync(projectDir: string, args: string[]): Promise<string> {
  let expoUpdatesCli;
  try {
    expoUpdatesCli =
      silentResolveFrom(projectDir, 'expo-updates/bin/cli') ??
      resolveFrom(projectDir, 'expo-updates/bin/cli.js');
  } catch (e: any) {
    if (e.code === 'MODULE_NOT_FOUND') {
      throw new ExpoUpdatesCLIModuleNotFoundError(
        `The \`expo-updates\` package was not found. Follow the installation directions at ${link(
          'https://docs.expo.dev/bare/installing-expo-modules/'
        )}`
      );
    }
    throw e;
  }

  try {
    return (await spawnAsync(expoUpdatesCli, args)).stdout;
  } catch (e: any) {
    if (e.stderr) {
      if ((e.stderr as string).includes('Invalid command')) {
        throw new ExpoUpdatesCLIInvalidCommandError(
          `The command specified by ${args} was not valid in the \`expo-updates\` CLI.`
        );
      }
    }
    throw e;
  }
}
