import { ExpoConfig } from '@expo/config';
import ConfigPlugins, { ExpoPlist } from '@expo/config-plugins';

import { RequestedPlatform } from '../../platform.js';
import { getProjectAccountName } from '../../project/projectUtils.js';
import { ensureLoggedInAsync } from '../../user/actions.js';
import { readPlistAsync, writePlistAsync } from '../../utils/plist.js';
import { getVcsClient } from '../../vcs/index.js';
import { ensureValidVersions } from '../utils.js';

const { IOSConfig } = ConfigPlugins;

export async function syncUpdatesConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  ensureValidVersions(exp, RequestedPlatform.Ios);
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
  const expoPlist = await readExpoPlistAsync(projectDir);
  const updatedExpoPlist = IOSConfig.Updates.setUpdatesConfig(
    projectDir,
    exp,
    expoPlist,
    accountName
  );
  await writeExpoPlistAsync(projectDir, updatedExpoPlist);
}

async function readExpoPlistAsync(projectDir: string): Promise<ExpoPlist> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(projectDir);
  return ((await readPlistAsync(expoPlistPath)) ?? {}) as ExpoPlist;
}

async function writeExpoPlistAsync(projectDir: string, expoPlist: ExpoPlist): Promise<void> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(projectDir);
  await writePlistAsync(expoPlistPath, expoPlist);
  await getVcsClient().trackFileAsync(expoPlistPath);
}

export async function readReleaseChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const expoPlist = await readExpoPlistAsync(projectDir);
    return expoPlist[IOSConfig.Updates.Config.RELEASE_CHANNEL] ?? null;
  } catch {
    return null;
  }
}

export async function readChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const expoPlist = await readExpoPlistAsync(projectDir);
    const updatesRequestHeaders = expoPlist['EXUpdatesRequestHeaders'];
    return updatesRequestHeaders['expo-channel-name'] ?? null;
  } catch {
    return null;
  }
}
