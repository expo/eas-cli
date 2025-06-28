import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import semver from 'semver';

import { getSimulatorAppIdAsync } from './simulator';
import * as xcode from './xcode';
import { installXcrunAsync, isXcrunInstalledAsync } from './xcrun';
import Log from '../../log';
import { promptAsync } from '../../prompts';

function assertPlatform(): void {
  if (process.platform !== 'darwin') {
    Log.error('iOS simulator apps can only be run on macOS devices.');
    throw Error('iOS simulator apps can only be run on macOS devices.');
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
  if (!(await isXcrunInstalledAsync())) {
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

async function assertSimulatorAppInstalledAsync(): Promise<void> {
  const simulatorAppId = await getSimulatorAppIdAsync();
  if (!simulatorAppId) {
    throw new Error(
      `Can't determine id of Simulator app; the Simulator is most likely not installed on this machine. Run 'sudo xcode-select -s /Applications/Xcode.app/Contents/Developer'`
    );
  }

  if (
    simulatorAppId !== 'com.apple.iphonesimulator' &&
    simulatorAppId !== 'com.apple.CoreSimulator.SimulatorTrampoline'
  ) {
    throw new Error(
      `Simulator is installed but is identified as '${simulatorAppId}', can't recognize what that is`
    );
  }

  try {
    // make sure we can run simctl
    await spawnAsync('xcrun', ['simctl', 'help']);
  } catch (error: any) {
    Log.warn(`Unable to run simctl:\n${error.toString()}`);
    throw new Error(
      'xcrun is not configured correctly. Ensure `sudo xcode-select --reset` works before running this command again.'
    );
  }
}

export async function validateSystemRequirementsAsync(): Promise<void> {
  assertPlatform();
  await assertCorrectXcodeVersionInstalledAsync();
  await ensureXcrunInstalledAsync();
  await assertSimulatorAppInstalledAsync();
}
