import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import log from '../../log';
import {
  ensureAppIdentifierIsDefinedAsync,
  getAndroidApplicationIdAsync,
  getProjectConfigDescription,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { gitAddAsync } from '../../utils/git';
import { Platform } from '../types';

enum ApplicationIdSource {
  AndroidProject,
  AppJson,
}

function isApplicationIdValid(applicationId: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(applicationId);
}

export async function ensureApplicationIdIsValidAsync(projectDir: string) {
  const applicationId = await ensureAppIdentifierIsDefinedAsync(projectDir, Platform.Android);
  if (!isApplicationIdValid(applicationId)) {
    const configDescription = getProjectConfigDescription(projectDir);
    log.error(
      `Invalid format of Android applicationId. Only alphanumeric characters, '.' and '_' are allowed, and each '.' must be followed by a letter.`
    );
    log.error(`Update "android.package" in ${configDescription} and run this command again.`);
    throw new Error('Invalid applicationId');
  }
}

export async function configureApplicationIdAsync(
  projectDir: string,
  exp: ExpoConfig,
  allowExperimental: boolean
): Promise<void> {
  const configDescription = getProjectConfigDescription(projectDir);
  const applicationIdFromConfig = AndroidConfig.Package.getPackage(exp);
  const applicationIdFromAndroidProject = await getAndroidApplicationIdAsync(projectDir);

  if (applicationIdFromAndroidProject && applicationIdFromConfig) {
    if (applicationIdFromConfig !== applicationIdFromAndroidProject) {
      log.newLine();
      log.warn(
        `We detected that your Android project is configured with a different application id than the one defined in ${configDescription}.`
      );
      const hasApplicationIdInStaticConfig = await hasApplicationIdInStaticConfigAsync(
        projectDir,
        exp
      );
      if (!hasApplicationIdInStaticConfig) {
        log(`If you choose the one defined in ${configDescription} we'll automatically configure your Android project with it.
However, if you choose the one defined in the Android project you'll have to update ${configDescription} on your own.`);
      }
      log.newLine();
      const { applicationIdSource } = await promptAsync({
        type: 'select',
        name: 'applicationIdSource',
        message: 'Which application id should we use?',
        choices: [
          {
            title: `${chalk.bold(
              applicationIdFromAndroidProject
            )} - In build.gradle in Android project`,
            value: ApplicationIdSource.AndroidProject,
          },
          {
            title: `${chalk.bold(applicationIdFromConfig)} - In your ${configDescription}`,
            value: ApplicationIdSource.AppJson,
          },
        ],
      });
      switch (applicationIdSource) {
        case ApplicationIdSource.AppJson: {
          await updateApplicationIdInBuildGradleAsync(projectDir, exp);
          break;
        }
        case ApplicationIdSource.AndroidProject: {
          if (hasApplicationIdInStaticConfig) {
            await updateAppJsonConfigAsync(projectDir, exp, applicationIdFromAndroidProject);
          } else {
            throw new Error(missingPackageMessage(configDescription));
          }
          break;
        }
      }
    }
  } else if (!applicationIdFromAndroidProject && !applicationIdFromConfig) {
    throw new Error(missingPackageMessage(configDescription));
  } else if (applicationIdFromAndroidProject && !applicationIdFromConfig) {
    if (getConfigFilePaths(projectDir).staticConfigPath) {
      await updateAppJsonConfigAsync(projectDir, exp, applicationIdFromAndroidProject);
    } else {
      throw new Error(missingPackageMessage(configDescription));
    }
  } else if (!applicationIdFromAndroidProject && applicationIdFromConfig) {
    // This should never happen, adding warning just in case
    log.warn(
      'applicationId is not specified in your ./android/app/build.gradle file. Make sure your project is configured correctly before building.'
    );
    return;
  }
  if (allowExperimental) {
    // this step is optional, the Play store is using applicationId value from build.gradle
    // to identify the app, so package name does not need to be updated
    await updatePackageNameAsync(projectDir, exp);
    await gitAddAsync(path.join(projectDir, 'android'), { intentToAdd: true });
  }
}

function missingPackageMessage(configDescription: string): string {
  return `Please define "android.package" in ${configDescription} and run "eas build:configure" again.`;
}

async function updateAppJsonConfigAsync(
  projectDir: string,
  exp: ExpoConfig,
  newApplicationId: string
): Promise<void> {
  const paths = getConfigFilePaths(projectDir);
  assert(paths.staticConfigPath, "can't update dynamic configs");

  const rawStaticConfig = await fs.readJSON(paths.staticConfigPath);
  rawStaticConfig.expo = {
    ...rawStaticConfig.expo,
    android: { ...rawStaticConfig.expo?.android, package: newApplicationId },
  };
  await fs.writeJson(paths.staticConfigPath, rawStaticConfig, { spaces: 2 });

  exp.android = { ...exp.android, package: newApplicationId };
}

/**
 * Check if static config exists and if expo.android.package is defined there.
 * It will return false if the value in static config is different than "android.package" in ExpoConfig
 */
async function hasApplicationIdInStaticConfigAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<boolean> {
  if (!exp.android?.package) {
    return false;
  }
  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath) {
    return false;
  }
  const rawStaticConfig = await fs.readJson(paths.staticConfigPath);
  return rawStaticConfig?.expo?.android?.package === exp.android.package;
}

async function updateApplicationIdInBuildGradleAsync(projectDir: string, exp: ExpoConfig) {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradle(projectDir);
  const buildGradleContents = await fs.readFile(buildGradlePath, 'utf8');
  const updatedBuildGradleContents = AndroidConfig.Package.setPackageInBuildGradle(
    exp,
    buildGradleContents
  );
  await fs.writeFile(buildGradlePath, updatedBuildGradleContents);
}

async function updatePackageNameAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  await AndroidConfig.Package.renamePackageOnDisk(exp, projectDir);

  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  if (!androidManifestPath) {
    throw new Error(`Could not find AndroidManifest.xml in project directory: "${projectDir}"`);
  }
  const androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
    androidManifestPath
  );
  const updatedAndroidManifest = AndroidConfig.Package.setPackageInAndroidManifest(
    exp,
    androidManifest
  );
  await AndroidConfig.Manifest.writeAndroidManifestAsync(
    androidManifestPath,
    updatedAndroidManifest
  );
}
