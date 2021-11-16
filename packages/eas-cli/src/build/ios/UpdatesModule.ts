import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';

import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { readPlistAsync, writePlistAsync } from '../../utils/plist';
import { getVcsClient } from '../../vcs';
import { ensureValidVersions } from '../utils/updates';

export async function configureUpdatesAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  ensureValidVersions(exp);
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());

  let expoPlist = await readExpoPlistAsync(projectDir);
  if (!IOSConfig.Updates.isPlistConfigurationSynced(exp, expoPlist, accountName)) {
    expoPlist = IOSConfig.Updates.setUpdatesConfig(exp, expoPlist, accountName);
    await writeExpoPlistAsync(projectDir, expoPlist);
  }
  // TODO: ensure ExpoPlist in pbxproj
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

  let expoPlist = await readExpoPlistAsync(projectDir);
  if (!IOSConfig.Updates.isPlistVersionConfigurationSynced(exp, expoPlist)) {
    expoPlist = IOSConfig.Updates.setVersionsConfig(exp, expoPlist);
    await writeExpoPlistAsync(projectDir, expoPlist);
  }

  if (!IOSConfig.Updates.isPlistConfigurationSynced(exp, expoPlist, accountName)) {
    Log.warn(
      'Native project configuration is not synced with values present in your app.json, run "eas build:configure" to make sure all values are applied in the native project'
    );
  }
}

// Note: we assume here that Expo modules are properly configured in the project. Aside from that,
// all that is needed on Expo SDK 43+ to configure expo-updates configuration in Expo.plist
async function ensureUpdatesConfiguredAsync(projectDir: string): Promise<void> {
  const expoPlist = await readExpoPlistAsync(projectDir);
  if (!IOSConfig.Updates.isPlistConfigurationSet(expoPlist)) {
    throw new Error('Missing values in Expo.plist');
  }
}

async function readExpoPlistAsync(projectDir: string): Promise<IOSConfig.ExpoPlist> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(projectDir);
  return ((await readPlistAsync(expoPlistPath)) ?? {}) as IOSConfig.ExpoPlist;
}

async function writeExpoPlistAsync(
  projectDir: string,
  expoPlist: IOSConfig.ExpoPlist
): Promise<void> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(projectDir);
  await writePlistAsync(expoPlistPath, expoPlist);
  await getVcsClient().trackFileAsync(expoPlistPath);
}

export async function readReleaseChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const expoPlist = await readExpoPlistAsync(projectDir);
    return expoPlist[IOSConfig.Updates.Config.RELEASE_CHANNEL] ?? null;
  } catch (err) {
    return null;
  }
}

export async function readChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const expoPlist: any = await readExpoPlistAsync(projectDir); // TODO-JJ remove any once IOSConfig.ExpoPlist is updated to include `EXUpdatesRequestHeaders : Record<string,string>`
    const updatesRequestHeaders = expoPlist['EXUpdatesRequestHeaders'] ?? {}; //TODO-JJ 'EXUpdatesRequestHeaders' IosConfig.Updates.Config.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY once https://github.com/expo/expo-cli/pull/3571 is published
    return updatesRequestHeaders['expo-channel-name'] ?? null;
  } catch (err) {
    return null;
  }
}
