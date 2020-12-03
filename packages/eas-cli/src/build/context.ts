import { ExpoConfig, getConfig } from '@expo/config';
import { AndroidBuildProfile, EasConfig, iOSBuildProfile } from '@expo/eas-json';

import { getProjectAccountName } from '../project/projectUtils';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { Platform, RequestedPlatform, TrackingContext } from './types';

export interface CommandContext {
  requestedPlatform: RequestedPlatform;
  profile: string;
  projectDir: string;
  projectId: string;
  user: Actor;
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
  projectId,
  trackingCtx,
  nonInteractive = false,
  skipCredentialsCheck = false,
  skipProjectConfiguration = false,
  waitForBuildEnd,
}: {
  requestedPlatform: RequestedPlatform;
  profile: string;
  projectId: string;
  projectDir: string;
  trackingCtx: TrackingContext;
  nonInteractive: boolean;
  skipCredentialsCheck: boolean;
  skipProjectConfiguration: boolean;
  waitForBuildEnd: boolean;
}): Promise<CommandContext> {
  const user = await ensureLoggedInAsync();
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  const accountName = getProjectAccountName(exp, user);
  const projectName = exp.slug;

  return {
    requestedPlatform,
    profile,
    projectDir,
    projectId,
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
  user: Actor;
  projectDir: string;
  exp: ExpoConfig;
  allowExperimental: boolean;
  requestedPlatform: RequestedPlatform;
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
  buildProfile: PlatformBuildProfile<T>;
}

export function createBuildContext<T extends Platform>({
  platform,
  easConfig,
  commandCtx,
}: {
  platform: T;
  easConfig: EasConfig;
  commandCtx: CommandContext;
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
  };
}
