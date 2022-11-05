import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import semver from 'semver';

import Log from '../../log';

// Based on the RN docs (Aug 2020).
export const MIN_XCODE_VERSION = '9.4.0';
export const APP_STORE_ID = '497799835';

export async function getXcodeVersionAsync(): Promise<string | undefined> {
  try {
    const { stdout } = await spawnAsync('xcodebuild', ['-version']);

    const version = stdout.match(/Xcode (\d+\.\d+)/)?.[1];

    const semverFormattedVersion = `${version}.0`;

    if (!semver.valid(semverFormattedVersion)) {
      Log.warn(
        `Xcode version ${chalk.bold(version)} is in unknown format. Expected format is ${chalk.bold(
          '12.0'
        )}.`
      );
      return undefined;
    }

    return semverFormattedVersion;
  } catch {
    // not installed
    return undefined;
  }
}

export async function openAppStoreAsync(appId: string): Promise<void> {
  const link = getAppStoreLink(appId);
  await spawnAsync(`open`, [link]);
}

function getAppStoreLink(appId: string): string {
  if (process.platform === 'darwin') {
    // TODO: Is there ever a case where the macappstore isn't available on mac?
    return `macappstore://itunes.apple.com/app/id${appId}`;
  }
  return `https://apps.apple.com/us/app/id${appId}`;
}
