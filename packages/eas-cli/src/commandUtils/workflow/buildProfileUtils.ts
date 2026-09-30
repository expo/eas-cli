import { ExpoConfig } from '@expo/config';
import { EasJson, EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

import { ensureProjectConfiguredAsync } from '../../build/configure';
import Log from '../../log';
import { RequestedPlatform } from '../../platform';
import {
  ensureEASUpdateIsConfiguredAsync,
  ensureEASUpdateIsConfiguredInEasJsonAsync,
} from '../../update/configure';
import { Client } from '../../vcs/vcs';

export const DEVELOPMENT_BUILD_PROFILE_NAME = 'development';
export const DEVELOPMENT_IOS_SIMULATOR_BUILD_PROFILE_NAME = 'development-ios-simulator';

export async function buildProfileNamesFromProjectAsync(projectDir: string): Promise<Set<string>> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);

  const buildProfileNames = new Set(
    easJsonAccessor && (await EasJsonUtils.getBuildProfileNamesAsync(easJsonAccessor))
  );
  return buildProfileNames;
}

export async function ensureDevelopmentBuildProfilesExistAsync(projectDir: string): Promise<void> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  await easJsonAccessor.readRawJsonAsync();
  const addedProfiles: string[] = [];
  easJsonAccessor.patch(easJsonRawObject => {
    easJsonRawObject.build = easJsonRawObject.build ?? {};
    if (!easJsonRawObject.build[DEVELOPMENT_BUILD_PROFILE_NAME]) {
      easJsonRawObject.build[DEVELOPMENT_BUILD_PROFILE_NAME] = {
        developmentClient: true,
        distribution: 'internal',
      };
      addedProfiles.push(DEVELOPMENT_BUILD_PROFILE_NAME);
    }
    if (!easJsonRawObject.build[DEVELOPMENT_IOS_SIMULATOR_BUILD_PROFILE_NAME]) {
      easJsonRawObject.build[DEVELOPMENT_IOS_SIMULATOR_BUILD_PROFILE_NAME] = {
        developmentClient: true,
        ios: {
          simulator: true,
        },
      };
      addedProfiles.push(DEVELOPMENT_IOS_SIMULATOR_BUILD_PROFILE_NAME);
    }
    return easJsonRawObject;
  });
  await easJsonAccessor.writeAsync();
  if (addedProfiles.length > 0) {
    Log.log(`Added the following build profiles to eas.json: ${addedProfiles.join(', ')}`);
  }
}

export async function addProductionBuildProfileToEasJsonIfNeededAsync(
  projectDir: string
): Promise<boolean> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  await easJsonAccessor.readRawJsonAsync();
  let profileAdded = false;
  easJsonAccessor.patch(easJsonRawObject => {
    if (!easJsonRawObject.build?.production) {
      profileAdded = true;
      easJsonRawObject.build = {
        ...(easJsonRawObject.build ?? {}),
        production: {},
      };
      // Also add the profile to submit
      easJsonRawObject.submit = {
        ...(easJsonRawObject.submit ?? {}),
        production: {},
      };
    }
    return easJsonRawObject;
  });
  if (profileAdded) {
    Log.log('Added missing production build profile to eas.json');
  }
  await easJsonAccessor.writeAsync();
  return profileAdded;
}

async function hasBuildConfigureBeenRunAsync({
  projectDir,
  expoConfig,
}: {
  projectDir: string;
  expoConfig: ExpoConfig;
}): Promise<boolean> {
  // Is there a project ID in the Expo config?
  if (!expoConfig.extra?.eas?.projectId) {
    return false;
  }
  // Is there an eas.json?
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  try {
    await easJsonAccessor.readAsync();
  } catch {
    return false;
  }
  return true;
}

async function hasUpdateConfigureBeenRunAsync({
  projectDir,
  expoConfig,
}: {
  projectDir: string;
  expoConfig: ExpoConfig;
}): Promise<boolean> {
  // Does the Expo config have an updates URL?
  if (!expoConfig.updates?.url) {
    return false;
  }
  // Does at least one build profile have a channel?
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  try {
    const easJson = await easJsonAccessor.readAsync();
    return Object.values(easJson.build ?? {}).some(buildProfile => !!buildProfile.channel);
  } catch {
    return false;
  }
}

export async function configureEasUpdateIfNeededAsync({
  projectDir,
  expoConfig,
  projectId,
  vcsClient,
}: {
  projectDir: string;
  expoConfig: ExpoConfig;
  projectId: string;
  vcsClient: Client;
}): Promise<void> {
  if (await hasUpdateConfigureBeenRunAsync({ projectDir, expoConfig })) {
    return;
  }
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  const easJsonCliConfig: EasJson['cli'] =
    (await EasJsonUtils.getCliConfigAsync(easJsonAccessor)) ?? {};
  await ensureEASUpdateIsConfiguredAsync({
    exp: expoConfig,
    projectId,
    projectDir,
    vcsClient,
    platform: RequestedPlatform.All,
    env: undefined,
    forceNativeConfigSync: true,
    manifestHostOverride: easJsonCliConfig?.updateManifestHostOverride ?? null,
  });
  await ensureEASUpdateIsConfiguredInEasJsonAsync(projectDir);
  Log.withTick('Configured EAS Update');
}

export async function configureEasBuildIfNeededAsync({
  projectDir,
  expoConfig,
  vcsClient,
}: {
  projectDir: string;
  expoConfig: ExpoConfig;
  vcsClient: Client;
}): Promise<void> {
  if (await hasBuildConfigureBeenRunAsync({ projectDir, expoConfig })) {
    return;
  }
  await ensureProjectConfiguredAsync({ projectDir, nonInteractive: false, vcsClient });
}
