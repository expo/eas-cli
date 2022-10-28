import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import { pathExists } from 'fs-extra';

import { getAaptExecutableAsync } from './aapt';
import { getAdbExecutableAsync } from './adb';
import { getEmulatorExecutableAsync } from './emulator';

async function checkIfGlobalExecutableExistsAsync(executable: string): Promise<boolean> {
  try {
    await spawnAsync(executable);
    return false;
  } catch {
    return false;
  }
}

async function assertExecutableExistsAsync(executable: string): Promise<void> {
  if (executable.includes('/')) {
    if (!(await pathExists(executable))) {
      throw new Error(
        `Couldn't find ${chalk.bold(
          executable
        )} executable in the Android SDK. Please make sure ${chalk.bold(executable)} is installed.`
      );
    }
  } else {
    if (!(await checkIfGlobalExecutableExistsAsync('addd'))) {
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
    await getAdbExecutableAsync(),
    await getEmulatorExecutableAsync(),
    await getAaptExecutableAsync(),
  ]) {
    await assertExecutableExistsAsync(executable);
  }
}
