import { AndroidConfig } from '@expo/config-plugins';
import fs from 'fs-extra';

export enum AndroidMetadataName {
  UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY = 'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY',
  RELEASE_CHANNEL = 'expo.modules.updates.EXPO_RELEASE_CHANNEL',
  RUNTIME_VERSION = 'expo.modules.updates.EXPO_RUNTIME_VERSION',
}

export async function androidSetChannelNativelyAsync(
  channel: string,
  workingDirectory: string
): Promise<void> {
  const manifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(workingDirectory);

  if (!(await fs.pathExists(manifestPath))) {
    throw new Error(`Couldn't find Android manifest at ${manifestPath}`);
  }

  const androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const mainApp = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const stringifiedUpdatesRequestHeaders = AndroidConfig.Manifest.getMainApplicationMetaDataValue(
    androidManifest,
    AndroidMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY
  );
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(
    mainApp,
    AndroidMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY,
    JSON.stringify({
      ...JSON.parse(stringifiedUpdatesRequestHeaders ?? '{}'),
      'expo-channel-name': channel,
    }),
    'value'
  );
  await AndroidConfig.Manifest.writeAndroidManifestAsync(manifestPath, androidManifest);
}

export async function androidSetRuntimeVersionNativelyAsync(
  runtimeVersion: string,
  workingDirectory: string
): Promise<void> {
  const manifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(workingDirectory);

  if (!(await fs.pathExists(manifestPath))) {
    throw new Error(`Couldn't find Android manifest at ${manifestPath}`);
  }

  const androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const mainApp = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(
    mainApp,
    AndroidMetadataName.RUNTIME_VERSION,
    runtimeVersion,
    'value'
  );
  await AndroidConfig.Manifest.writeAndroidManifestAsync(manifestPath, androidManifest);
}

export async function androidGetNativelyDefinedChannelAsync(
  workingDirectory: string
): Promise<string | null> {
  const manifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(workingDirectory);

  if (!(await fs.pathExists(manifestPath))) {
    return null;
  }

  const androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const stringifiedUpdatesRequestHeaders = AndroidConfig.Manifest.getMainApplicationMetaDataValue(
    androidManifest,
    AndroidMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY
  );
  try {
    const updatesRequestHeaders = JSON.parse(stringifiedUpdatesRequestHeaders ?? '{}');
    return updatesRequestHeaders['expo-channel-name'] ?? null;
  } catch (err: any) {
    throw new Error(
      `Failed to parse ${AndroidMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY} from AndroidManifest.xml: ${err.message}`
    );
  }
}
