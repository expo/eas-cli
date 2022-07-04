import { ExpoConfig } from '@expo/config';
import ConfigPlugins, { AndroidManifest } from '@expo/config-plugins';

import { RequestedPlatform } from '../../platform.js';
import { getProjectAccountName } from '../../project/projectUtils.js';
import { ensureLoggedInAsync } from '../../user/actions.js';
import { ensureValidVersions } from '../utils.js';

const { AndroidConfig } = ConfigPlugins;

export async function syncUpdatesConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  ensureValidVersions(exp, RequestedPlatform.Android);
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());

  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  const androidManifest = await getAndroidManifestAsync(projectDir);

  const updatedAndroidManifest = AndroidConfig.Updates.setUpdatesConfig(
    projectDir,
    exp,
    androidManifest,
    accountName
  );
  await AndroidConfig.Manifest.writeAndroidManifestAsync(
    androidManifestPath,
    updatedAndroidManifest
  );
}

export async function readReleaseChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const androidManifest = await getAndroidManifestAsync(projectDir);
    return AndroidConfig.Manifest.getMainApplicationMetaDataValue(
      androidManifest,
      AndroidConfig.Updates.Config.RELEASE_CHANNEL
    );
  } catch {
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
  } catch {
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
