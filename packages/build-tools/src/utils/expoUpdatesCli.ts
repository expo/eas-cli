import resolveFrom, { silent as silentResolveFrom } from 'resolve-from';
import spawnAsync from '@expo/turtle-spawn';
import { BuildStepEnv } from '@expo/steps';

export class ExpoUpdatesCLIModuleNotFoundError extends Error {}
export class ExpoUpdatesCLIInvalidCommandError extends Error {}
export class ExpoUpdatesCLICommandFailedError extends Error {}

export async function expoUpdatesCommandAsync(
  projectDir: string,
  args: string[],
  { env }: { env: BuildStepEnv }
): Promise<string> {
  let expoUpdatesCli;
  try {
    expoUpdatesCli =
      silentResolveFrom(projectDir, 'expo-updates/bin/cli') ??
      resolveFrom(projectDir, 'expo-updates/bin/cli.js');
  } catch (e: any) {
    if (e.code === 'MODULE_NOT_FOUND') {
      throw new ExpoUpdatesCLIModuleNotFoundError(
        `The \`expo-updates\` package was not found. Follow the installation directions at https://docs.expo.dev/bare/installing-expo-modules/`
      );
    }
    throw e;
  }

  try {
    const spawnResult = await spawnAsync(expoUpdatesCli, args, {
      stdio: 'pipe',
      cwd: projectDir,
      env,
    });
    return spawnResult.stdout;
  } catch (e: any) {
    if (e.stderr && typeof e.stderr === 'string') {
      if (e.stderr.includes('Invalid command')) {
        throw new ExpoUpdatesCLIInvalidCommandError(
          `The command specified by ${args} was not valid in the \`expo-updates\` CLI.`
        );
      } else {
        throw new ExpoUpdatesCLICommandFailedError(e.stderr);
      }
    }
    throw e;
  }
}
