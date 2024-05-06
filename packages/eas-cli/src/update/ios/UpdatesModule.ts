import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Env, Workflow } from '@expo/eas-build-job';

import { RequestedPlatform } from '../../platform';
import { isModernExpoUpdatesCLIWithRuntimeVersionCommandSupportedAsync } from '../../project/projectUtils';
import { expoUpdatesCommandAsync } from '../../utils/expoUpdatesCli';
import { readPlistAsync, writePlistAsync } from '../../utils/plist';
import { Client } from '../../vcs/vcs';
import { ensureValidVersions } from '../utils';

export async function syncUpdatesConfigurationAsync({
  vcsClient,
  projectDir,
  exp,
  workflow,
  env,
}: {
  vcsClient: Client;
  projectDir: string;
  exp: ExpoConfig;
  workflow: Workflow;
  env: Env | undefined;
}): Promise<void> {
  ensureValidVersions(exp, RequestedPlatform.Ios);

  if (await isModernExpoUpdatesCLIWithRuntimeVersionCommandSupportedAsync(projectDir)) {
    await expoUpdatesCommandAsync(
      projectDir,
      ['configuration:syncnative', '--platform', 'ios', '--workflow', workflow],
      { env }
    );
    return;
  }

  const expoPlist = await readExpoPlistAsync(projectDir);
  // TODO(wschurman): this dependency needs to be updated for fingerprint
  const updatedExpoPlist = await IOSConfig.Updates.setUpdatesConfigAsync(
    projectDir,
    exp,
    expoPlist
  );
  await writeExpoPlistAsync(vcsClient, projectDir, updatedExpoPlist);
}

async function readExpoPlistAsync(projectDir: string): Promise<IOSConfig.ExpoPlist> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(projectDir);
  return ((await readPlistAsync(expoPlistPath)) ?? {}) as IOSConfig.ExpoPlist;
}

async function writeExpoPlistAsync(
  vcsClient: Client,
  projectDir: string,
  expoPlist: IOSConfig.ExpoPlist
): Promise<void> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(projectDir);
  await writePlistAsync(expoPlistPath, expoPlist);
  await vcsClient.trackFileAsync(expoPlistPath);
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
