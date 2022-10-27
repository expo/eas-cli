import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import { existsSync } from 'fs-extra';

import { getAaptExecutablePathAsync } from './aapt';
import { adbExecutablePath } from './adb';
import { emulatorExecutablePath } from './emulator';

async function whichAsync(executable: string): Promise<string | null> {
  const { stdout } = await spawnAsync('which', [executable]);

  if (!stdout || stdout.includes('not found')) {
    return null;
  }

  return stdout.trim();
}

function assertExecutableExists(executable: string): void {
  if (executable.includes('/')) {
    if (!existsSync(executable)) {
      throw new Error(
        `Couldn't find ${chalk.bold(
          executable
        )} executable in the Android SDK. Please make sure it's installed.`
      );
    }
  } else {
    if (!whichAsync(executable)) {
      throw new Error(
        `Couldn't find ${chalk.bold(
          executable
        )} executable in your PATH. Please make sure Android Studio is installed on your device and ${chalk.bold(
          'ANDROID_HOME'
        )} or ${chalk.bold('ANDROID_SDK_ROOT')} env variables are set.`
      );
    }
  }
}

export async function assertExecutablesExistAsync(): Promise<void> {
  for (const executable of [
    adbExecutablePath,
    emulatorExecutablePath,
    await getAaptExecutablePathAsync(),
  ]) {
    assertExecutableExists(executable);
  }
}
