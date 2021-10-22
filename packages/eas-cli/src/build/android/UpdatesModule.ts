import { ExpoConfig } from '@expo/config';
import { AndroidConfig, AndroidManifest } from '@expo/config-plugins';
import fs from 'fs-extra';

import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { ensureValidVersions } from '../utils/updates';

export async function configureUpdatesAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  ensureValidVersions(exp);
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());

  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  const androidManifest = await getAndroidManifestAsync(projectDir);

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
    await ensureUpdatesConfiguredAsync(projectDir);
  } catch (error) {
    Log.error(
      'expo-updates module is not configured. Please run "eas build:configure" first to configure the project'
    );
    throw error;
  }

  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  let androidManifest = await getAndroidManifestAsync(projectDir);

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

// Note: we assume here that Expo modules are properly configured in the project. Aside from that,
// all that is needed on Expo SDK 43+ to configure expo-updates configuration in AndroidManifest.xml
async function ensureUpdatesConfiguredAsync(projectDir: string): Promise<void> {
  const androidManifest = await getAndroidManifestAsync(projectDir);

  if (!AndroidConfig.Updates.isMainApplicationMetaDataSet(androidManifest)) {
    throw new Error('Missing values in AndroidManifest.xml');
  }
}

export async function readReleaseChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const androidManifest = await getAndroidManifestAsync(projectDir);
    return AndroidConfig.Manifest.getMainApplicationMetaDataValue(
      androidManifest,
      AndroidConfig.Updates.Config.RELEASE_CHANNEL
    );
  } catch (err) {
    return null;
  }
}

export async function readChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const androidManifest = await getAndroidManifestAsync(projectDir);
    const stringifiedRequestHeaders = AndroidConfig.Manifest.getMainApplicationMetaDataValue(
      androidManifest,
      AndroidConfig.Updates.Config.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY
    );
    if (!stringifiedRequestHeaders) {
      return null;
    }
    return JSON.parse(stringifiedRequestHeaders)['expo-channel-name'] ?? null;
  } catch (err) {
    return null;
  }
}

async function getAndroidManifestAsync(projectDir: string): Promise<AndroidManifest> {
  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  if (!androidManifestPath) {
    throw new Error(`Could not find AndroidManifest.xml in project directory: "${projectDir}"`);
  }
  return AndroidConfig.Manifest.readAndroidManifestAsync(androidManifestPath);
}
