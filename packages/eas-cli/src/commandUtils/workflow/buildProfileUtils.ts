import { BuildProfile, EasJsonAccessor, EasJsonUtils, Platform } from '@expo/eas-json';
import { AndroidBuildProfile, IosBuildProfile } from '@expo/eas-json/build/build/types';

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
