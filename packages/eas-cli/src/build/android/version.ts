import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';

import Log from '../../log';
import {
  getAppBuildGradleAsync,
  parseGradleCommand,
  resolveConfigValue,
} from '../../project/android/gradleUtils';
import { resolveWorkflowAsync } from '../../project/workflow';
import { updateAppJsonConfigAsync } from '../utils/appJson';
import { bumpAppVersionAsync, ensureStaticConfigExists } from '../utils/version';

export enum BumpStrategy {
  APP_VERSION,
  VERSION_CODE,
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

  const buildGradle = await getAppBuildGradleAsync(projectDir);
  const isMultiFlavor =
    buildGradle.android?.productFlavors || buildGradle.android?.flavorDimensions;
  if (isMultiFlavor) {
    throw new Error(
      'Automatic version bumping is not supported for multi-flavor Android projects.'
    );
  }

  await bumpVersionInAppJsonAsync({ bumpStrategy, projectDir, exp });
  Log.log('Updated versions in app.json');
  await writeVersionsToBuildGradleAsync({
    projectDir,
    exp,
  });
  Log.log('Synchronized versions with build gradle');
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

  if (bumpStrategy === BumpStrategy.APP_VERSION) {
    const appVersion = AndroidConfig.Version.getVersionName(exp) ?? '1.0.0';
    await bumpAppVersionAsync({ appVersion, projectDir, exp });
  } else {
    const versionCode = AndroidConfig.Version.getVersionCode(exp);
    const bumpedVersionCode = versionCode + 1;
    Log.log(
      `Bumping ${chalk.bold('expo.android.versionCode')} from ${chalk.bold(
        versionCode
      )} to ${chalk.bold(bumpedVersionCode)}`
    );
    await updateAppJsonConfigAsync({ projectDir, exp }, config => {
      config.android = { ...config.android, versionCode: bumpedVersionCode };
    });
  }
}

export async function maybeResolveVersionsAsync(
  projectDir: string,
  exp: ExpoConfig,
  buildProfile: BuildProfile<Platform.ANDROID>
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
  if (workflow === Workflow.GENERIC) {
    const buildGradle = await getAppBuildGradleAsync(projectDir);
    try {
      const parsedGradleCommand = buildProfile.gradleCommand
        ? parseGradleCommand(buildProfile.gradleCommand, buildGradle)
        : undefined;

      return {
        appVersion:
          resolveConfigValue(buildGradle, 'versionName', parsedGradleCommand?.flavor) ?? '1.0.0',
        appBuildVersion:
          resolveConfigValue(buildGradle, 'versionCode', parsedGradleCommand?.flavor) ?? '1',
      };
    } catch (err: any) {
      return {};
    }
  } else {
    return {
      appBuildVersion: String(AndroidConfig.Version.getVersionCode(exp)),
      appVersion: exp.version,
    };
  }
}

async function writeVersionsToBuildGradleAsync({
  projectDir,
  exp,
}: {
  projectDir: string;
  exp: ExpoConfig;
}): Promise<string> {
  const buildGradle = await readBuildGradleAsync(projectDir);
  if (!buildGradle) {
    throw new Error('This project is missing a build.gradle file.');
  }
  let updatedBuildGradle = AndroidConfig.Version.setVersionName(exp, buildGradle);
  updatedBuildGradle = AndroidConfig.Version.setVersionCode(exp, updatedBuildGradle);
  await writeBuildGradleAsync({ projectDir, buildGradle: updatedBuildGradle });
  return updatedBuildGradle;
}

async function readBuildGradleAsync(projectDir: string): Promise<string | undefined> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
  if (!(await fs.pathExists(buildGradlePath))) {
    return undefined;
  }
  return await fs.readFile(buildGradlePath, 'utf8');
}

async function writeBuildGradleAsync({
  projectDir,
  buildGradle,
}: {
  projectDir: string;
  buildGradle: string;
}): Promise<void> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
  await fs.writeFile(buildGradlePath, buildGradle);
}
