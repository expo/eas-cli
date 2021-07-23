import { Android, Ios } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import { AndroidBuildProfile, IosBuildProfile } from './DeprecatedConfig.types';
import { EasJson as DeprecatedEasJson, EasJsonReader } from './DeprecatedEasJsonReader';
import { EasJson, RawBuildProfile } from './EasJson.types';

export async function isUsingDeprecatedFormatAsync(projectDir: string): Promise<boolean> {
  const rawFile = await fs.readFile(path.join(projectDir, 'eas.json'), 'utf8');
  const json = JSON.parse(rawFile);
  return !!json?.builds;
}

export async function hasMismatchedExtendsAsync(projectDir: string): Promise<boolean> {
  const rawFile = await fs.readFile(path.join(projectDir, 'eas.json'), 'utf8');
  const rawEasJson = JSON.parse(rawFile) as DeprecatedEasJson;
  const profiles = new Set<string>();
  Object.keys(rawEasJson.builds.android ?? {}).forEach(profile => profiles.add(profile));
  Object.keys(rawEasJson.builds.ios ?? {}).forEach(profile => profiles.add(profile));

  let hasMismatchedExtendsKeys = false;
  profiles.forEach(profileName => {
    if (rawEasJson?.builds?.ios?.[profileName] !== rawEasJson?.builds?.android?.[profileName]) {
      hasMismatchedExtendsKeys = true;
    }
  });
  return hasMismatchedExtendsKeys;
}

export async function migrateAsync(projectDir: string): Promise<void> {
  const reader = new EasJsonReader(projectDir, 'all');
  try {
    await reader.validateAsync();
  } catch (err) {
    throw new Error(
      `Valid eas.json is required to automatically migrate to the new format\n${err.msg}`
    );
  }
  const rawFile = await fs.readFile(path.join(projectDir, 'eas.json'), 'utf8');
  const rawEasJson = JSON.parse(rawFile) as DeprecatedEasJson;
  const profiles = new Set<string>();
  Object.keys(rawEasJson.builds.android ?? {}).forEach(profile => profiles.add(profile));
  Object.keys(rawEasJson.builds.ios ?? {}).forEach(profile => profiles.add(profile));

  const result: EasJson = {
    build: {},
  };
  profiles.forEach(profileName => {
    result.build[profileName] = migrateProfile(rawEasJson, profileName);
  });
  await fs.writeFile(path.join(projectDir, 'eas.json'), `${JSON.stringify(result, null, 2)}\n`);
}

interface MigrateContext {
  androidProfile?: Partial<AndroidBuildProfile>;
  iosProfile?: Partial<IosBuildProfile>;
}

export function migrateProfile(
  rawEasJson: DeprecatedEasJson,
  profileName: string
): RawBuildProfile {
  const androidProfile = (rawEasJson?.builds?.android?.[profileName] ??
    {}) as AndroidBuildProfile & { extends?: string };
  const iosProfile = (rawEasJson?.builds?.ios?.[profileName] ?? {}) as IosBuildProfile & {
    extends?: string;
  };
  let profile: RawBuildProfile = {
    android: {},
    ios: {},
  };
  const ctx = { androidProfile, iosProfile };
  const androidCtx = { androidProfile };
  const iosCtx = { iosProfile };

  // simple common values
  profile = migrateProperty('credentialsSource', profile, ctx);
  profile = migrateProperty('releaseChannel', profile, ctx);
  profile = migrateProperty('channel', profile, ctx);
  profile = migrateProperty('node', profile, ctx);
  profile = migrateProperty('yarn', profile, ctx);
  profile = migrateProperty('expoCli', profile, ctx);
  if (androidProfile.extends && androidProfile.extends === iosProfile.extends) {
    profile = migrateProperty('extends', profile, ctx);
  }

  // android
  profile = migrateProperty('image', profile, androidCtx);
  profile = migrateProperty('ndk', profile, androidCtx);
  profile = migrateProperty('gradleCommand', profile, androidCtx);
  profile = migrateProperty('artifactPath', profile, androidCtx);
  profile = migrateProperty('env', profile, androidCtx);
  profile = migrateProperty('cache', profile, androidCtx);
  profile = migrateProperty('withoutCredentials', profile, androidCtx);

  // ios
  profile = migrateProperty('enterpriseProvisioning', profile, iosCtx);
  profile = migrateProperty('autoIncrement', profile, iosCtx);
  profile = migrateProperty('image', profile, iosCtx);
  profile = migrateProperty('bundler', profile, iosCtx);
  profile = migrateProperty('fastlane', profile, iosCtx);
  profile = migrateProperty('cocoapods', profile, iosCtx);
  profile = migrateProperty('artifactPath', profile, iosCtx);
  profile = migrateProperty('scheme', profile, iosCtx);
  profile = migrateProperty('env', profile, iosCtx);
  profile = migrateProperty('cache', profile, iosCtx);

  profile = migrateProperty('developmentClient', profile, {
    androidProfile: {
      ...androidProfile,
      developmentClient:
        androidProfile.buildType === Android.BuildType.DEVELOPMENT_CLIENT || undefined,
    } as any,
    iosProfile: {
      ...iosProfile,
      developmentClient: iosProfile.buildType === Ios.BuildType.DEVELOPMENT_CLIENT || undefined,
    } as any,
  });
  if (
    androidProfile.buildType &&
    androidProfile.buildType !== Android.BuildType.DEVELOPMENT_CLIENT
  ) {
    profile.android!.buildType = androidProfile.buildType;
  }
  if (iosProfile.distribution === 'simulator') {
    profile.ios!.simulator = true;
    delete (iosProfile as any).distribution;
  }
  profile = migrateProperty('distribution', profile, ctx);

  if (iosProfile.schemeBuildConfiguration) {
    profile.ios!.buildConfiguration = iosProfile.schemeBuildConfiguration;
  }
  if (Object.keys(profile.android ?? {}).length === 0) {
    delete profile.android;
  }
  if (Object.keys(profile.ios ?? {}).length === 0) {
    delete profile.ios;
  }
  return profile;
}

function migrateProperty(
  key: string,
  profile: RawBuildProfile,
  ctx: MigrateContext
): RawBuildProfile {
  const androidProperty = (ctx.androidProfile as any)?.[key];
  const iosProperty = (ctx.iosProfile as any)?.[key];

  if (androidProperty && iosProperty && androidProperty === iosProperty) {
    return { ...profile, [key]: androidProperty };
  } else {
    return {
      ...profile,
      android: {
        ...profile.android,
        ...(androidProperty ? { [key]: androidProperty } : {}),
      },
      ios: {
        ...profile.ios,
        ...(iosProperty ? { [key]: iosProperty } : {}),
      },
    };
  }
}
