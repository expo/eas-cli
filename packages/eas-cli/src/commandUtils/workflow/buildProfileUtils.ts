import { ExpoConfig } from '@expo/config';
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

import BuildConfigure from '../../commands/build/configure';
import UpdateConfigure from '../../commands/update/configure';
import Log from '../../log';
import { promptAsync } from '../../prompts';

/**
 * Build profile names used by the "Create development builds" workflow template.
 */
export const DEVELOPMENT_BUILD_PROFILE_NAME = 'development';
export const DEVELOPMENT_IOS_SIMULATOR_BUILD_PROFILE_NAME = 'development-ios-simulator';

export async function buildProfileNamesFromProjectAsync(projectDir: string): Promise<Set<string>> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);

  const buildProfileNames = new Set(
    easJsonAccessor && (await EasJsonUtils.getBuildProfileNamesAsync(easJsonAccessor))
  );
  return buildProfileNames;
}

/**
 * Ensures the build profiles used by the development builds workflow exist in eas.json:
 * - "development": development client build for Android and iOS devices.
 * - "development-ios-simulator": development client build for iOS simulators.
 */
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
