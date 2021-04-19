import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import Log from '../../log';
import {
  getAndroidApplicationIdAsync,
  getProjectConfigDescription,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import {
  assertPackageValid,
  getOrPromptForPackageAsync,
  setPackageInExpoConfigAsync,
} from '../../utils/promptConfigModifications';

enum ApplicationIdSource {
  AndroidProject,
  AppJson,
}

export async function configureApplicationIdAsync(
  projectDir: string,
  exp: ExpoConfig,
  allowExperimental: boolean
): Promise<string> {
  const applicationId = await _configureApplicationIdAsync(projectDir, exp, allowExperimental);
  assertPackageValid(applicationId);
  // TODO: Maybe check the git status here, skipping for now because it'll show too often.
  // await ensureGitStatusIsCleanAsync();
  return applicationId;
}

export async function _configureApplicationIdAsync(
  projectDir: string,
  exp: ExpoConfig,
  allowExperimental: boolean
): Promise<string> {
  const applicationIdFromConfig = AndroidConfig.Package.getPackage(exp);
  const applicationIdFromAndroidProject = await getAndroidApplicationIdAsync(projectDir);

  if (applicationIdFromAndroidProject && applicationIdFromConfig) {
    const configDescription = getProjectConfigDescription(projectDir);

    if (applicationIdFromConfig !== applicationIdFromAndroidProject) {
      Log.newLine();
      Log.warn(
        `We detected that your Android project is configured with a different application id than the one defined in ${configDescription}.`
      );
      const hasApplicationIdInStaticConfig = await hasApplicationIdInStaticConfigAsync(
        projectDir,
        exp
      );
      if (!hasApplicationIdInStaticConfig) {
        Log.log(`If you choose the one defined in ${configDescription} we'll automatically configure your Android project with it.
However, if you choose the one defined in the Android project you'll have to update ${configDescription} on your own.`);
      }
      Log.newLine();
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
          // Update native
          await updatePackageNameAsync(projectDir, exp);
          await updateApplicationIdInBuildGradleAsync(projectDir, exp);
          return applicationIdFromConfig;
        }
        case ApplicationIdSource.AndroidProject: {
          const applicationId = await setPackageInExpoConfigAsync(
            projectDir,
            applicationIdFromAndroidProject,
            exp
          );
          if (!exp.android) exp.android = {};
          exp.android.package = applicationId;
          return applicationId;
        }
      }
    }
  }

  let applicationId: string;
  if (applicationIdFromConfig) {
    applicationId = applicationIdFromConfig;
    // Update native
    await updatePackageNameAsync(projectDir, exp);
    await updateApplicationIdInBuildGradleAsync(projectDir, exp);
  } else if (applicationIdFromAndroidProject) {
    applicationId = await setPackageInExpoConfigAsync(
      projectDir,
      applicationIdFromAndroidProject,
      exp
    );
  } else {
    applicationId = await getOrPromptForPackageAsync(projectDir);
    // Only update if the native folder exists, this allows support for prompting in managed.
    if (fs.existsSync(path.join(projectDir, 'android'))) {
      // Update native
      await updatePackageNameAsync(projectDir, exp);
      await updateApplicationIdInBuildGradleAsync(projectDir, exp);
    }
  }
  // sync up the config
  if (!exp.android) exp.android = {};
  exp.android.package = applicationId;

  return applicationId;
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
