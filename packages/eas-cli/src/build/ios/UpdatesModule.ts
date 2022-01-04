import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';

import { getProjectAccountName } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { readPlistAsync, writePlistAsync } from '../../utils/plist';
import { getVcsClient } from '../../vcs';
import { ensureValidVersions } from '../utils/updates';

export async function syncUpdatesConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  ensureValidVersions(exp);
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
  const expoPlist = await readExpoPlistAsync(projectDir);
  const updatedExpoPlist = IOSConfig.Updates.setUpdatesConfig(exp, expoPlist, accountName);
  await writeExpoPlistAsync(projectDir, updatedExpoPlist);
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
    // TODO-JJ remove any once IOSConfig.ExpoPlist is updated to include `EXUpdatesRequestHeaders : Record<string,string>`
    const expoPlist: any = await readExpoPlistAsync(projectDir);
    //TODO-JJ 'EXUpdatesRequestHeaders' IosConfig.Updates.Config.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY once https://github.com/expo/expo-cli/pull/3571 is published
    const updatesRequestHeaders = expoPlist['EXUpdatesRequestHeaders'] ?? {};
    return updatesRequestHeaders['expo-channel-name'] ?? null;
  } catch (err) {
    return null;
  }
}
