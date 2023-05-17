import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { RequestedPlatform } from '../../platform';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { readPlistAsync, writePlistAsync } from '../../utils/plist';
import { getVcsClient } from '../../vcs';
import { ensureValidVersions } from '../utils';

export async function syncUpdatesConfigurationAsync(
  graphqlClient: ExpoGraphqlClient,
  projectDir: string,
  exp: ExpoConfig,
  projectId: string
): Promise<void> {
  ensureValidVersions(exp, RequestedPlatform.Ios);
  const accountName = (await getOwnerAccountForProjectIdAsync(graphqlClient, projectId)).name;
  const expoPlist = await readExpoPlistAsync(projectDir);
  const updatedExpoPlist = IOSConfig.Updates.setUpdatesConfig(
    projectDir,
    exp,
    expoPlist,
    accountName
  );
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
  } catch {
    return null;
  }
}

export async function readChannelSafelyAsync(projectDir: string): Promise<string | null> {
  try {
    const expoPlist = await readExpoPlistAsync(projectDir);
    const updatesRequestHeaders = expoPlist['EXUpdatesRequestHeaders'];
    return updatesRequestHeaders?.['expo-channel-name'] ?? null;
  } catch {
    return null;
  }
}
