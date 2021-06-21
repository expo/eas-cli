import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import fs from 'fs-extra';

import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { gitAddAsync } from '../../utils/git';
import { ensureValidVersions } from '../utils/updates';
import { readPlistAsync, writePlistAsync } from './plist';

export async function configureUpdatesAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  ensureValidVersions(exp);
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
  let xcodeProject = IOSConfig.XcodeUtils.getPbxproj(projectDir);

  if (!IOSConfig.Updates.isShellScriptBuildPhaseConfigured(projectDir, xcodeProject)) {
    xcodeProject = IOSConfig.Updates.ensureBundleReactNativePhaseContainsConfigurationScript(
      projectDir,
      xcodeProject
    );
    await fs.writeFile(IOSConfig.Paths.getPBXProjectPath(projectDir), xcodeProject.writeSync());
  }

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
    await ensureUpdatesConfiguredAsync(projectDir, exp);
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

async function ensureUpdatesConfiguredAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  const xcodeProject = IOSConfig.XcodeUtils.getPbxproj(projectDir);

  if (!IOSConfig.Updates.isShellScriptBuildPhaseConfigured(projectDir, xcodeProject)) {
    const script = 'expo-updates/scripts/create-manifest-ios.sh';
    const buildPhase = '"Bundle React Native code and images"';
    throw new Error(`Path to ${script} is missing in a ${buildPhase} build phase.`);
  }

  const expoPlist = await readExpoPlistAsync(projectDir);
  if (!IOSConfig.Updates.isPlistConfigurationSet(expoPlist)) {
    throw new Error('Missing values in Expo.plist');
  }
}

async function readExpoPlistAsync(projectDir: string): Promise<IOSConfig.ExpoPlist> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(projectDir);
  return await readPlistAsync(expoPlistPath);
}

async function writeExpoPlistAsync(
  projectDir: string,
  expoPlist: IOSConfig.ExpoPlist
): Promise<void> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(projectDir);
  await writePlistAsync(expoPlistPath, expoPlist);
  await gitAddAsync(expoPlistPath, { intentToAdd: true });
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
