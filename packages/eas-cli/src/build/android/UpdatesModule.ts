import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import fs from 'fs-extra';

import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { ensureValidVersions } from '../utils/updates';

export async function configureUpdatesAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  ensureValidVersions(exp);
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradle(projectDir);
  const buildGradleContents = await fs.readFile(buildGradlePath, 'utf8');

  if (!AndroidConfig.Updates.isBuildGradleConfigured(projectDir, buildGradleContents)) {
    const updatedBuildGradleContents = AndroidConfig.Updates.ensureBuildGradleContainsConfigurationScript(
      projectDir,
      buildGradleContents
    );
    await fs.writeFile(buildGradlePath, updatedBuildGradleContents);
  }

  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  if (!androidManifestPath) {
    throw new Error(`Could not find AndroidManifest.xml in project directory: "${projectDir}"`);
  }
  const androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
    androidManifestPath
  );

  if (!AndroidConfig.Updates.isMainApplicationMetaDataSynced(exp, androidManifest, accountName)) {
    const result = AndroidConfig.Updates.setUpdatesConfig(exp, androidManifest, accountName);

    await AndroidConfig.Manifest.writeAndroidManifestAsync(androidManifestPath, result);
  }
}

export async function syncUpdatesConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  ensureValidVersions(exp);
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
  try {
    await ensureUpdatesConfiguredAsync(projectDir, exp);
  } catch (error) {
    Log.error(
      'expo-updates module is not configured. Please run "eas build:configure" first to configure the project'
    );
    throw error;
  }

  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  if (!androidManifestPath) {
    throw new Error(`Could not find AndroidManifest.xml in project directory: "${projectDir}"`);
  }
  let androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(androidManifestPath);

  if (!AndroidConfig.Updates.areVersionsSynced(exp, androidManifest)) {
    androidManifest = AndroidConfig.Updates.setVersionsConfig(exp, androidManifest);
    await AndroidConfig.Manifest.writeAndroidManifestAsync(androidManifestPath, androidManifest);
  }

  if (!AndroidConfig.Updates.isMainApplicationMetaDataSynced(exp, androidManifest, accountName)) {
    Log.warn(
      'Native project configuration is not synced with values present in your app.json, run "eas build:configure" to make sure all values are applied in the native project'
    );
  }
}

async function ensureUpdatesConfiguredAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradle(projectDir);
  const buildGradleContents = await fs.readFile(buildGradlePath, 'utf8');

  if (!AndroidConfig.Updates.isBuildGradleConfigured(projectDir, buildGradleContents)) {
    const gradleScriptApply = AndroidConfig.Updates.formatApplyLineForBuildGradle(projectDir);
    throw new Error(`Missing ${gradleScriptApply} in ${buildGradlePath}`);
  }

  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  if (!androidManifestPath) {
    throw new Error(`Could not find AndroidManifest.xml in project directory: "${projectDir}"`);
  }
  const androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
    androidManifestPath
  );

  if (!AndroidConfig.Updates.isMainApplicationMetaDataSet(androidManifest)) {
    throw new Error('Missing values in AndroidManifest.xml');
  }
}

export async function readReleaseChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
    if (!androidManifestPath) {
      throw new Error(`Could not find AndroidManifest.xml in project directory: "${projectDir}"`);
    }
    const androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      androidManifestPath
    );
    return AndroidConfig.Manifest.getMainApplicationMetaDataValue(
      androidManifest,
      AndroidConfig.Updates.Config.RELEASE_CHANNEL
    );
  } catch (err) {
    return null;
  }
}
