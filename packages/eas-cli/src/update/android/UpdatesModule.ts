import { ExpoConfig } from '@expo/config';
import { AndroidConfig, AndroidManifest, XML } from '@expo/config-plugins';
import { Env, Workflow } from '@expo/eas-build-job';

import { RequestedPlatform } from '../../platform';
import { isModernExpoUpdatesCLIWithRuntimeVersionCommandSupportedAsync } from '../../project/projectUtils';
import { expoUpdatesCommandAsync } from '../../utils/expoUpdatesCli';
import { ensureValidVersions } from '../utils';

/**
 * Synchronize updates configuration to native files. This needs to do essentially the same thing as `withUpdates`
 */
export async function syncUpdatesConfigurationAsync({
  projectDir,
  exp,
  workflow,
  env,
}: {
  projectDir: string;
  exp: ExpoConfig;
  workflow: Workflow;
  env: Env | undefined;
}): Promise<void> {
  ensureValidVersions(exp, RequestedPlatform.Android);

  if (await isModernExpoUpdatesCLIWithRuntimeVersionCommandSupportedAsync(projectDir)) {
    await expoUpdatesCommandAsync(
      projectDir,
      ['configuration:syncnative', '--platform', 'android', '--workflow', workflow],
      { env }
    );
    return;
  }

  // sync AndroidManifest.xml
  const androidManifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(projectDir);
  const androidManifest = await getAndroidManifestAsync(projectDir);
  const updatedAndroidManifest = await AndroidConfig.Updates.setUpdatesConfigAsync(
    projectDir,
    exp,
    androidManifest
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

  // TODO(wschurman): this dependency needs to be updated for fingerprint
  const updatedStringsResourceXML =
    await AndroidConfig.Updates.applyRuntimeVersionFromConfigForProjectRootAsync(
      projectDir,
      exp,
      stringsResourceXML
    );
  await XML.writeXMLAsync({ path: stringsJSONPath, xml: updatedStringsResourceXML });
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
  return await AndroidConfig.Manifest.readAndroidManifestAsync(androidManifestPath);
}
