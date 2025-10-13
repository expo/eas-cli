import { ExpoConfig } from '@expo/config';
import { BuildProfile, EasJsonAccessor, EasJsonUtils, Platform } from '@expo/eas-json';
import { AndroidBuildProfile, IosBuildProfile } from '@expo/eas-json/build/build/types';

import BuildConfigure from '../../commands/build/configure';
import UpdateConfigure from '../../commands/update/configure';
import Log from '../../log';
import { promptAsync } from '../../prompts';

export async function buildProfileNamesFromProjectAsync(projectDir: string): Promise<Set<string>> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);

  const buildProfileNames = new Set(
    easJsonAccessor && (await EasJsonUtils.getBuildProfileNamesAsync(easJsonAccessor))
  );
  return buildProfileNames;
}
export async function getBuildProfileAsync(
  projectDir: string,
  platform: Platform,
  profileName: string
): Promise<BuildProfile<Platform>> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  const buildProfile = await EasJsonUtils.getBuildProfileAsync(
    easJsonAccessor,
    platform,
    profileName
  );
  return buildProfile;
}
export async function buildProfilesFromProjectAsync(
  projectDir: string
): Promise<Map<string, { android: AndroidBuildProfile; ios: IosBuildProfile }>> {
  const buildProfileNames = await buildProfileNamesFromProjectAsync(projectDir);
  const buildProfiles: Map<string, { android: AndroidBuildProfile; ios: IosBuildProfile }> =
    new Map();
  for (const profileName of buildProfileNames) {
    const iosBuildProfile = (await getBuildProfileAsync(
      projectDir,
      Platform.IOS,
      profileName
    )) as IosBuildProfile;
    const androidBuildProfile = (await getBuildProfileAsync(
      projectDir,
      Platform.ANDROID,
      profileName
    )) as AndroidBuildProfile;
    buildProfiles.set(profileName, { android: androidBuildProfile, ios: iosBuildProfile });
  }
  return buildProfiles;
}
export function isBuildProfileForDevelopment(
  buildProfile: BuildProfile<Platform>,
  platform: Platform
): boolean {
  if (buildProfile.developmentClient) {
    return true;
  }
  if (platform === Platform.ANDROID) {
    return (buildProfile as BuildProfile<Platform.ANDROID>).gradleCommand === ':app:assembleDebug';
  }
  if (platform === Platform.IOS) {
    return (buildProfile as BuildProfile<Platform.IOS>).buildConfiguration === 'Debug';
  }
  return false;
}
export function isIosBuildProfileForSimulator(buildProfile: BuildProfile<Platform.IOS>): boolean {
  return buildProfile.simulator ?? false;
}
export async function addAndroidDevelopmentBuildProfileToEasJsonAsync(
  projectDir: string,
  buildProfileName: string
): Promise<void> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  await easJsonAccessor.readRawJsonAsync();
  easJsonAccessor.patch(easJsonRawObject => {
    easJsonRawObject.build = {
      ...easJsonRawObject.build,
      [buildProfileName]: {
        developmentClient: true,
        distribution: 'internal',
        android: {
          gradleCommand: ':app:assembleDebug',
        },
      },
    };
    return easJsonRawObject;
  });
  await easJsonAccessor.writeAsync();
}
export async function addIosDevelopmentBuildProfileToEasJsonAsync(
  projectDir: string,
  buildProfileName: string,
  simulator: boolean
): Promise<void> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  await easJsonAccessor.readRawJsonAsync();
  easJsonAccessor.patch(easJsonRawObject => {
    easJsonRawObject.build = {
      ...easJsonRawObject.build,
      [buildProfileName]: {
        developmentClient: true,
        distribution: 'internal',
        ios: {
          buildConfiguration: 'Debug',
          simulator,
        },
      },
    };
    return easJsonRawObject;
  });
  await easJsonAccessor.writeAsync();
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

export async function hasBuildConfigureBeenRunAsync({
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

export async function hasUpdateConfigureBeenRunAsync({
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

/**
 * Runs update:configure if needed. Returns a boolean (proceed with workflow creation, or not)
 */

export async function runUpdateConfigureIfNeededAsync({
  projectDir,
  expoConfig,
}: {
  projectDir: string;
  expoConfig: ExpoConfig;
}): Promise<boolean> {
  if (
    await hasUpdateConfigureBeenRunAsync({
      projectDir,
      expoConfig,
    })
  ) {
    return true;
  }
  const nextStep = (
    await promptAsync({
      type: 'select',
      name: 'nextStep',
      message:
        'You have chosen to create a workflow that requires EAS Update configuration. What would you like to do?',
      choices: [
        { title: 'Configure EAS Update and then proceed', value: 'configure' },
        { title: 'EAS Update is already configured, proceed', value: 'proceed' },
        { title: 'Choose a different workflow template', value: 'repeat' },
      ],
    })
  ).nextStep;
  switch (nextStep) {
    case 'configure':
      Log.newLine();
      await UpdateConfigure.run([]);
      return true;
    case 'proceed':
      return true;
    default:
      return false;
  }
}
/**
 * Runs build:configure if needed. Returns a boolean (proceed with workflow creation, or not)
 */
export async function runBuildConfigureIfNeededAsync({
  projectDir,
  expoConfig,
}: {
  projectDir: string;
  expoConfig: ExpoConfig;
}): Promise<boolean> {
  if (
    await hasBuildConfigureBeenRunAsync({
      projectDir,
      expoConfig,
    })
  ) {
    return true;
  }
  const nextStep = (
    await promptAsync({
      type: 'select',
      name: 'nextStep',
      message:
        'You have chosen to create a workflow that requires EAS Build configuration. What would you like to do?',
      choices: [
        { title: 'Configure EAS Build and then proceed', value: 'configure' },
        { title: 'EAS Build is already configured, proceed', value: 'proceed' },
        { title: 'Choose a different workflow template', value: 'repeat' },
      ],
    })
  ).nextStep;
  switch (nextStep) {
    case 'configure':
      Log.newLine();
      await BuildConfigure.run(['-p', 'all']);
      return true;
    case 'proceed':
      return true;
    default:
      return false;
  }
}
