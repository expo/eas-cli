import { ExpoConfig } from '@expo/config';
import { AndroidConfig, AndroidManifest, XML } from '@expo/config-plugins';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { RequestedPlatform } from '../../platform';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { ensureValidVersions } from '../utils';

/**
 * Synchronize updates configuration to native files. This needs to do essentially the same thing as `withUpdates`
 */
export async function syncUpdatesConfigurationAsync(
  graphqlClient: ExpoGraphqlClient,
  projectDir: string,
  exp: ExpoConfig,
  projectId: string
): Promise<void> {
  ensureValidVersions(exp, RequestedPlatform.Android);
  const accountName = (await getOwnerAccountForProjectIdAsync(graphqlClient, projectId)).name;

  AndroidConfig.Updates.withUpdates(exp, { expoUsername: null });

  // sync AndroidManifest.xml
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

  // sync strings.xml
  const stringsJSONPath = await AndroidConfig.Strings.getProjectStringsXMLPathAsync(projectDir);
  const stringsResourceXML = await AndroidConfig.Resources.readResourcesXMLAsync({
    path: stringsJSONPath,
  });
  const updatedStringsResourceXML = AndroidConfig.Updates.applyRuntimeVersionFromConfig(
    exp,
    stringsResourceXML
  );
  await XML.writeXMLAsync({ path: stringsJSONPath, xml: updatedStringsResourceXML });
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
