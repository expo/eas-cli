import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import chalk from 'chalk';
import nullthrows from 'nullthrows';
import path from 'path';
import semver from 'semver';
import type { XCBuildConfiguration } from 'xcode';

import Log from '../../log';
import { resolveWorkflowAsync } from '../../project/workflow';
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
  buildSettings,
}: {
  projectDir: string;
  exp: ExpoConfig;
  bumpStrategy: BumpStrategy;
  buildSettings: XCBuildConfiguration['buildSettings'];
}): Promise<void> {
  if (bumpStrategy === BumpStrategy.NOOP) {
    return;
  }
  ensureStaticConfigExists(projectDir);
  const infoPlist = await readInfoPlistAsync(projectDir, buildSettings);
  await bumpVersionInAppJsonAsync({ bumpStrategy, projectDir, exp });
  Log.log('Updated versions in app.json');
  await writeVersionsToInfoPlistAsync({ projectDir, exp, infoPlist, buildSettings });
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

export async function readShortVersionAsync(
  projectDir: string,
  exp: ExpoConfig,
  buildSettings: XCBuildConfiguration['buildSettings']
): Promise<string | undefined> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS);
  if (workflow === Workflow.GENERIC) {
    const infoPlist = await readInfoPlistAsync(projectDir, buildSettings);
    return (
      infoPlist.CFBundleShortVersionString &&
      evaluateTemplateString(infoPlist.CFBundleShortVersionString, buildSettings)
    );
  } else {
    return exp.version;
  }
}

export async function readBuildNumberAsync(
  projectDir: string,
  exp: ExpoConfig,
  buildSettings: XCBuildConfiguration['buildSettings']
): Promise<string | undefined> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS);
  if (workflow === Workflow.GENERIC) {
    const infoPlist = await readInfoPlistAsync(projectDir, buildSettings);
    return (
      infoPlist.CFBundleVersion && evaluateTemplateString(infoPlist.CFBundleVersion, buildSettings)
    );
  } else {
    return IOSConfig.Version.getBuildNumber(exp);
  }
}

export async function maybeResolveVersionsAsync(
  projectDir: string,
  exp: ExpoConfig,
  buildSettings: XCBuildConfiguration['buildSettings']
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  try {
    return {
      appBuildVersion: await readBuildNumberAsync(projectDir, exp, buildSettings),
      appVersion: await readShortVersionAsync(projectDir, exp, buildSettings),
    };
  } catch {
    return {};
  }
}

async function writeVersionsToInfoPlistAsync({
  projectDir,
  exp,
  infoPlist,
  buildSettings,
}: {
  projectDir: string;
  exp: ExpoConfig;
  infoPlist: IOSConfig.InfoPlist;
  buildSettings: XCBuildConfiguration['buildSettings'];
}): Promise<IOSConfig.InfoPlist> {
  let updatedInfoPlist = IOSConfig.Version.setVersion(exp, infoPlist);
  updatedInfoPlist = IOSConfig.Version.setBuildNumber(exp, updatedInfoPlist);
  await writeInfoPlistAsync({ projectDir, infoPlist: updatedInfoPlist, buildSettings });
  return updatedInfoPlist;
}

export function getInfoPlistPath(
  projectDir: string,
  buildSettings: XCBuildConfiguration['buildSettings']
): string {
  if (buildSettings.INFOPLIST_FILE) {
    const infoPlistFile = buildSettings.INFOPLIST_FILE.startsWith('"')
      ? buildSettings.INFOPLIST_FILE.slice(1, -1)
      : buildSettings.INFOPLIST_FILE;
    const iosDir = path.join(projectDir, 'ios');
    const plistPath = evaluateTemplateString(infoPlistFile, {
      ...buildSettings,
      SRCROOT: iosDir,
    });
    return path.isAbsolute(plistPath) ? plistPath : path.resolve(iosDir, plistPath);
  } else {
    return IOSConfig.Paths.getInfoPlistPath(projectDir);
  }
}

async function readInfoPlistAsync(
  projectDir: string,
  buildSettings: XCBuildConfiguration['buildSettings']
): Promise<IOSConfig.InfoPlist> {
  const infoPlistPath = getInfoPlistPath(projectDir, buildSettings);
  return (await readPlistAsync(infoPlistPath)) as IOSConfig.InfoPlist;
}

async function writeInfoPlistAsync({
  projectDir,
  infoPlist,
  buildSettings,
}: {
  projectDir: string;
  infoPlist: IOSConfig.InfoPlist;
  buildSettings: XCBuildConfiguration['buildSettings'];
}): Promise<void> {
  const infoPlistPath = getInfoPlistPath(projectDir, buildSettings);
  await writePlistAsync(infoPlistPath, infoPlist);
}

function ensureStaticConfigExists(projectDir: string): void {
  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath) {
    throw new Error('autoIncrement option is not supported when using app.config.js');
  }
}

export function evaluateTemplateString(s: string, vars: Record<string, any>): string {
  return s.replace(/\$\((\w+)\)/g, (match, key) => {
    if (vars.hasOwnProperty(key)) {
      const value = String(vars[key]);
      return value.startsWith('"') ? value.slice(1, -1) : value;
    } else {
      return match;
    }
  });
}
