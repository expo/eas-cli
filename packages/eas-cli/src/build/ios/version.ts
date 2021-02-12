import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import chalk from 'chalk';
import nullthrows from 'nullthrows';
import semver from 'semver';

import Log from '../../log';
import { promptAsync } from '../../prompts';
import { updateAppJsonConfigAsync } from '../utils/appJson';
import { readPlistAsync, writePlistAsync } from './plist';

export enum BumpStrategy {
  SHORT_VERSION,
  BUILD_NUMBER,
  NOOP,
}

export async function bumpVersionAsync({
  bumpStrategy,
  projectDir,
  exp,
}: {
  projectDir: string;
  exp: ExpoConfig;
  bumpStrategy: BumpStrategy;
}): Promise<void> {
  if (bumpStrategy === BumpStrategy.NOOP) {
    return;
  }
  ensureStaticConfigExists(projectDir);
  const infoPlist = await readInfoPlistAsync(projectDir);
  await bumpVersionInAppJsonAsync({ bumpStrategy, projectDir, exp });
  Log.log('Updated versions in app.json');
  await writeVersionsToInfoPlistAsync({ projectDir, exp, infoPlist });
  Log.log('Synchronized versions with Info.plist');
}

export async function bumpVersionInAppJsonAsync({
  bumpStrategy,
  projectDir,
  exp,
}: {
  bumpStrategy: BumpStrategy;
  projectDir: string;
  exp: ExpoConfig;
}): Promise<void> {
  if (bumpStrategy === BumpStrategy.NOOP) {
    return;
  }
  ensureStaticConfigExists(projectDir);
  Log.addNewLineIfNone();
  if (bumpStrategy === BumpStrategy.SHORT_VERSION) {
    const shortVersion = IOSConfig.Version.getVersion(exp);
    if (semver.valid(shortVersion)) {
      const bumpedShortVersion = nullthrows(semver.inc(shortVersion, 'patch'));
      Log.log(
        `Bumping ${chalk.bold('expo.version')} from ${chalk.bold(shortVersion)} to ${chalk.bold(
          bumpedShortVersion
        )}`
      );
      await updateAppJsonConfigAsync({ projectDir, exp }, config => {
        config.version = bumpedShortVersion;
      });
    } else {
      Log.log(`${chalk.bold('expo.version')} = ${chalk.bold(shortVersion)} is not a valid semver`);
      const { bumpedShortVersion } = await promptAsync({
        type: 'text',
        name: 'bumpedShortVersion',
        message: 'What is the next version?',
      });
      await updateAppJsonConfigAsync({ projectDir, exp }, config => {
        config.version = bumpedShortVersion;
      });
    }
  } else {
    const buildNumber = IOSConfig.Version.getBuildNumber(exp);
    if (buildNumber.match(/^\d+(\.\d+)*$/)) {
      const comps = buildNumber.split('.');
      comps[comps.length - 1] = String(Number(comps[comps.length - 1]) + 1);
      const bumpedBuildNumber = comps.join('.');
      Log.log(
        `Bumping ${chalk.bold('expo.ios.buildNumber')} from ${chalk.bold(
          buildNumber
        )} to ${chalk.bold(bumpedBuildNumber)}`
      );
      await updateAppJsonConfigAsync({ projectDir, exp }, config => {
        config.ios = { ...config.ios, buildNumber: String(bumpedBuildNumber) };
      });
    } else {
      Log.log(`${chalk.bold('expo.ios.buildNumber')} = ${chalk.bold(buildNumber)} is not a number`);
      const { bumpedBuildNumber } = await promptAsync({
        type: 'text',
        name: 'bumpedBuildNumber',
        message: 'What is the next build number?',
      });
      await updateAppJsonConfigAsync({ projectDir, exp }, config => {
        config.ios = { ...config.ios, buildNumber: String(bumpedBuildNumber) };
      });
    }
  }
}

async function readInfoPlistAsync(projectDir: string): Promise<IOSConfig.InfoPlist> {
  const infoPlistPath = IOSConfig.Paths.getInfoPlistPath(projectDir);
  return await readPlistAsync(infoPlistPath);
}

async function writeVersionsToInfoPlistAsync({
  projectDir,
  exp,
  infoPlist,
}: {
  projectDir: string;
  exp: ExpoConfig;
  infoPlist: IOSConfig.InfoPlist;
}): Promise<IOSConfig.InfoPlist> {
  let updatedInfoPlist = IOSConfig.Version.setVersion(exp, infoPlist);
  updatedInfoPlist = IOSConfig.Version.setBuildNumber(exp, updatedInfoPlist);
  await writeInfoPlistAsync({ projectDir, infoPlist: updatedInfoPlist });
  return updatedInfoPlist;
}

async function writeInfoPlistAsync({
  projectDir,
  infoPlist,
}: {
  projectDir: string;
  infoPlist: IOSConfig.InfoPlist;
}): Promise<void> {
  const infoPlistPath = IOSConfig.Paths.getInfoPlistPath(projectDir);
  await writePlistAsync(infoPlistPath, infoPlist);
}

function ensureStaticConfigExists(projectDir: string): void {
  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath) {
    throw new Error('autoIncrement option is not supported when using app.config.js');
  }
}
