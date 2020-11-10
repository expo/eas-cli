import { AndroidBuildProfile, EasConfig, iOSBuildProfile } from '@eas/config';
import { ExpoConfig, getConfig } from '@expo/config';

import { getProjectAccountNameAsync } from '../project/projectUtils';
import { User } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { BuildCommandPlatform, Platform, TrackingContext } from './types';

export interface CommandContext {
  requestedPlatform: BuildCommandPlatform;
  profile: string;
  projectDir: string;
  user: User;
  accountName: string;
  projectName: string;
  exp: ExpoConfig;
  trackingCtx: TrackingContext;
  nonInteractive: boolean;
  skipCredentialsCheck: boolean;
  skipProjectConfiguration: boolean;
  waitForBuildEnd: boolean;
}

export async function createCommandContextAsync({
  requestedPlatform,
  profile,
  projectDir,
  trackingCtx,
  nonInteractive = false,
  skipCredentialsCheck = false,
  skipProjectConfiguration = false,
  waitForBuildEnd,
}: {
  requestedPlatform: BuildCommandPlatform;
  profile: string;
  projectDir: string;
  trackingCtx: TrackingContext;
  nonInteractive: boolean;
  skipCredentialsCheck: boolean;
  skipProjectConfiguration: boolean;
  waitForBuildEnd: boolean;
}): Promise<CommandContext> {
  const user = await ensureLoggedInAsync();
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  const accountName = await getProjectAccountNameAsync(projectDir);
  const projectName = exp.slug;

  return {
    requestedPlatform,
    profile,
    projectDir,
    user,
    accountName,
    projectName,
    exp,
    trackingCtx,
    nonInteractive,
    skipCredentialsCheck,
    skipProjectConfiguration,
    waitForBuildEnd,
  };
}

export interface ConfigureContext {
  user: User;
  projectDir: string;
  exp: ExpoConfig;
  shouldConfigureAndroid: boolean;
  shouldConfigureIos: boolean;
  hasAndroidNativeProject: boolean;
  hasIosNativeProject: boolean;
}

type PlatformBuildProfile<T extends Platform> = T extends Platform.Android
  ? AndroidBuildProfile
  : iOSBuildProfile;

export interface BuildContext<T extends Platform> {
  commandCtx: CommandContext;
  trackingCtx: TrackingContext;
  platform: T;
  projectId: string;
  buildProfile: PlatformBuildProfile<T>;
}

export function createBuildContext<T extends Platform>({
  platform,
  easConfig,
  commandCtx,
  projectId,
}: {
  platform: T;
  easConfig: EasConfig;
  commandCtx: CommandContext;
  projectId: string;
}): BuildContext<T> {
  const buildProfile = easConfig.builds[platform] as PlatformBuildProfile<T> | undefined;
  if (!buildProfile) {
    throw new Error(`${platform} build profile does not exist`);
  }
  const builderTrackingCtx = {
    ...commandCtx.trackingCtx,
    platform,
  };
  return {
    commandCtx,
    trackingCtx: builderTrackingCtx,
    platform,
    buildProfile,
    projectId,
  };
}
