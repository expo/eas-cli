import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';

import { getAaptExecutableAsync } from './aapt';
import { getAdbExecutableAsync } from './adb';
import { getEmulatorExecutableAsync } from './emulator';

async function assertExecutableExistsAsync(executable: string, options?: string[]): Promise<void> {
  try {
    await spawnAsync(executable, options);
  } catch (err: any) {
    throw new Error(
      `${chalk.bold(
        executable
      )} executable doesn't seem to work. Please make sure Android Studio is installed on your device and ${chalk.bold(
        'ANDROID_HOME'
      )} or ${chalk.bold('ANDROID_SDK_ROOT')} env variables are set.
${err.message}`
    );
  }
}

export async function assertExecutablesExistAsync(): Promise<void> {
  await assertExecutableExistsAsync(await getAdbExecutableAsync(), ['--version']);
  await assertExecutableExistsAsync(await getEmulatorExecutableAsync(), ['-list-avds']);
  await assertExecutableExistsAsync(await getAaptExecutableAsync(), ['version']);
}
