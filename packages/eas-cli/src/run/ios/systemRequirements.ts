import chalk from 'chalk';
import semver from 'semver';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import * as xcode from './xcode';
import { installXcrunAsync, isXcrunInstalledAsync } from './xcrun';

function assertPlatform(): void {
  if (process.platform !== 'darwin') {
    Log.error(
      chalk`iOS apps can only be built on macOS devices. Use {cyan eas build -p ios} to build in the cloud.`
    );
    throw Error('iOS apps can only be built on macOS devices.');
  }
}

async function assertCorrectXcodeVersionInstalledAsync(): Promise<void> {
  const xcodeVersion = await xcode.getXcodeVersionAsync();

  if (!xcodeVersion) {
    const { goToAppStore } = await promptAsync({
      type: 'select',
      message: 'Xcode needs to be installed, would you like to continue to the App Store?',
      name: 'goToAppStore',
      choices: [
        { title: 'Yes', value: true },
        { title: 'No', value: false },
      ],
    });

    if (goToAppStore) {
      await xcode.openAppStoreAsync(xcode.APP_STORE_ID);
    }

    throw Error('Please try again once Xcode is installed');
  }

  if (semver.lt(xcodeVersion, xcode.MIN_XCODE_VERSION)) {
    throw Error(
      `Xcode version ${chalk.bold(xcodeVersion)} is too old. Please upgrade to version ${chalk.bold(
        xcode.MIN_XCODE_VERSION
      )} or higher.`
    );
  }
}

async function ensureXcrunInstalledAsync(): Promise<void> {
  if (!isXcrunInstalledAsync()) {
    const { installXcrun } = await promptAsync({
      type: 'select',
      message: 'Xcode Command Line Tools need to be installed, continue?',
      name: 'installXcrun',
      choices: [
        { title: 'Yes', value: true },
        { title: 'No', value: false },
      ],
    });

    if (installXcrun) {
      await installXcrunAsync();
      return;
    }

    throw Error('Please try again once Xcode Command Line Tools are installed');
  }
}

export async function ensureSystemRequirementsAsync(): Promise<void> {
  assertPlatform();
  await assertCorrectXcodeVersionInstalledAsync();
  await ensureXcrunInstalledAsync();
}
