import { ExpoConfig } from '@expo/config';
import { Workflow } from '@expo/eas-build-job';
import { AndroidBuildProfile, EasConfig, IosBuildProfile } from '@expo/eas-json';
import JsonFile from '@expo/json-file';
import resolveFrom from 'resolve-from';
import { v4 as uuidv4 } from 'uuid';

import { getProjectAccountName } from '../project/projectUtils';
import { findAccountByName } from '../user/Account';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { Platform, RequestedPlatform, TrackingContext } from './types';
import Analytics, { Event } from './utils/analytics';

export interface CommandContext {
  requestedPlatform: RequestedPlatform;
  profile: string;
  projectDir: string;
  projectId: string;
  user: Actor;
  accountName: string;
  projectName: string;
  exp: ExpoConfig;
  nonInteractive: boolean;
  local: boolean;
  clearCache: boolean;
  skipProjectConfiguration: boolean;
  waitForBuildEnd: boolean;
}

export async function createCommandContextAsync({
  requestedPlatform,
  profile,
  exp,
  projectDir,
  projectId,
  nonInteractive = false,
  local,
  clearCache = false,
  skipProjectConfiguration = false,
  waitForBuildEnd,
}: {
  requestedPlatform: RequestedPlatform;
  profile: string;
  exp: ExpoConfig;
  projectId: string;
  projectDir: string;
  nonInteractive: boolean;
  local: boolean;
  clearCache: boolean;
  skipProjectConfiguration: boolean;
  waitForBuildEnd: boolean;
}): Promise<CommandContext> {
  const user = await ensureLoggedInAsync();
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
    nonInteractive,
    local,
    clearCache,
    skipProjectConfiguration,
    waitForBuildEnd,
  };
}

export interface ConfigureContext {
  user: Actor;
  projectDir: string;
  exp: ExpoConfig;
  requestedPlatform: RequestedPlatform;
  shouldConfigureAndroid: boolean;
  shouldConfigureIos: boolean;
  hasAndroidNativeProject: boolean;
  hasIosNativeProject: boolean;
}

type PlatformBuildProfile<T extends Platform> = T extends Platform.ANDROID
  ? AndroidBuildProfile
  : IosBuildProfile;

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

  const accountId = findAccountByName(commandCtx.user.accounts, commandCtx.accountName)?.id;
  const devClientProperties = getDevClientEventProperties(platform, commandCtx, buildProfile);
  const trackingCtx = {
    tracking_id: uuidv4(),
    platform,
    ...(accountId && { account_id: accountId }),
    account_name: commandCtx.accountName,
    project_id: commandCtx.projectId,
    project_type: buildProfile.workflow,
    ...devClientProperties,
  };
  Analytics.logEvent(Event.BUILD_COMMAND, trackingCtx);
  return {
    commandCtx,
    trackingCtx,
    platform,
    buildProfile,
  };
}

function getDevClientEventProperties(
  platform: Platform,
  commandCtx: CommandContext,
  buildProfile: AndroidBuildProfile | IosBuildProfile
): Partial<TrackingContext> {
  let includesDevClient;
  const version = tryGetDevClientVersion(commandCtx.projectDir);
  if (buildProfile.workflow === Workflow.MANAGED) {
    includesDevClient = buildProfile.buildType === 'development-client';
  } else if (platform === Platform.ANDROID && 'gradleCommand' in buildProfile) {
    includesDevClient = Boolean(version && buildProfile.gradleCommand?.includes('Debug'));
  } else if (platform === Platform.IOS && 'schemeBuildConfiguration' in buildProfile) {
    includesDevClient = Boolean(version && buildProfile.schemeBuildConfiguration === 'Debug');
  } else {
    includesDevClient = false;
  }

  if (version) {
    return { dev_client: includesDevClient, dev_client_version: version };
  } else {
    return { dev_client: includesDevClient };
  }
}

function tryGetDevClientVersion(projectDir: string): string | null {
  try {
    const pkg = JsonFile.read(resolveFrom(projectDir, 'expo-dev-client/package.json'));
    return pkg.version?.toString() ?? null;
  } catch {
    return null;
  }
}
