import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import chalk from 'chalk';
import nullthrows from 'nullthrows';
import semver from 'semver';

import { updateAppJsonConfigAsync } from './appJson';
import Log from '../../log';
import { promptAsync } from '../../prompts';

export function ensureStaticConfigExists(projectDir: string): void {
  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath) {
    throw new Error('autoIncrement option is not supported when using app.config.js');
  }
}

export async function bumpAppVersionAsync({
  appVersion,
  projectDir,
  exp,
}: {
  appVersion: string;
  projectDir: string;
  exp: ExpoConfig;
}): Promise<void> {
  let bumpedAppVersion: string;
  if (semver.valid(appVersion)) {
    bumpedAppVersion = nullthrows(semver.inc(appVersion, 'patch'));
    Log.log(
      `Bumping ${chalk.bold('expo.version')} from ${chalk.bold(appVersion)} to ${chalk.bold(
        bumpedAppVersion
      )}`
    );
  } else {
    Log.log(`${chalk.bold('expo.version')} = ${chalk.bold(appVersion)} is not a valid semver`);
    bumpedAppVersion = (
      await promptAsync({
        type: 'text',
        name: 'bumpedAppVersion',
        message: 'What is the next version?',
      })
    ).bumpedAppVersion;
  }
  await updateAppJsonConfigAsync({ projectDir, exp }, config => {
    config.version = bumpedAppVersion;
  });
}
