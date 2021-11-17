import { ExpoConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { AndroidBuildProfile, BuildProfile, IosBuildProfile } from '@expo/eas-json';
import JsonFile from '@expo/json-file';
import resolveFrom from 'resolve-from';
import { v4 as uuidv4 } from 'uuid';

import { TrackingContext } from '../analytics/common';
import { Analytics, BuildEvent } from '../analytics/events';
import { CredentialsContext } from '../credentials/context';
import { RequestedPlatform } from '../platform';
import { getExpoConfig } from '../project/expoConfig';
import { getProjectAccountName, getProjectIdAsync } from '../project/projectUtils';
import { resolveWorkflowAsync } from '../project/workflow';
import { findAccountByName } from '../user/Account';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';

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

export interface AndroidBuildContext {
  applicationId: string;
  buildProfile: BuildProfile<Platform.ANDROID>;
}

export interface IosBuildContext {
  bundleIdentifier: string;
  buildProfile: BuildProfile<Platform.IOS>;
}

export interface BuildContext<T extends Platform> {
  accountName: string;
  buildProfileName: string;
  clearCache: boolean;
  credentialsCtx: CredentialsContext;
  exp: ExpoConfig;
  local: boolean;
  nonInteractive: boolean;
  platform: T;
  projectDir: string;
  projectId: string;
  projectName: string;
  skipProjectConfiguration: boolean;
  trackingCtx: TrackingContext;
  user: Actor;
  workflow: Workflow;
  android: T extends Platform.ANDROID ? AndroidBuildContext : undefined;
  ios: T extends Platform.IOS ? IosBuildContext : undefined;
}

export async function createBuildContextAsync<T extends Platform>({
  buildProfileName,
  buildProfile,
  clearCache = false,
  local,
  nonInteractive = false,
  platform,
  projectDir,
  skipProjectConfiguration = false,
}: {
  buildProfileName: string;
  buildProfile: BuildProfile<T>;
  clearCache: boolean;
  local: boolean;
  nonInteractive: boolean;
  platform: T;
  projectDir: string;
  skipProjectConfiguration: boolean;
}): Promise<BuildContext<T>> {
  const exp = getExpoConfig(projectDir, { env: buildProfile.env });

  const user = await ensureLoggedInAsync();
  const accountName = getProjectAccountName(exp, user);
  const projectName = exp.slug;
  const projectId = await getProjectIdAsync(exp, { env: buildProfile.env });
  const workflow = await resolveWorkflowAsync(projectDir, platform);
  const accountId = findAccountByName(user.accounts, accountName)?.id;

  const credentialsCtx = new CredentialsContext({
    exp,
    nonInteractive,
    projectDir,
    user,
  });

  const devClientProperties = getDevClientEventProperties({
    platform,
    projectDir,
    buildProfile,
  });
  const trackingCtx = {
    tracking_id: uuidv4(),
    platform,
    ...(accountId && { account_id: accountId }),
    account_name: accountName,
    project_id: projectId,
    project_type: workflow,
    ...devClientProperties,
  };
  Analytics.logEvent(BuildEvent.BUILD_COMMAND, trackingCtx);

  return {
    accountName,
    buildProfile,
    buildProfileName,
    clearCache,
    credentialsCtx,
    exp,
    local,
    nonInteractive,
    platform,
    projectDir,
    projectId,
    projectName,
    skipProjectConfiguration,
    trackingCtx,
    user,
    workflow,
  };
}

function getDevClientEventProperties({
  platform,
  projectDir,
  buildProfile,
}: {
  platform: Platform;
  projectDir: string;
  buildProfile: AndroidBuildProfile | IosBuildProfile;
}): Partial<TrackingContext> {
  let includesDevClient;
  const version = tryGetDevClientVersion(projectDir);
  if (platform === Platform.ANDROID && 'gradleCommand' in buildProfile) {
    includesDevClient = Boolean(version && buildProfile.gradleCommand?.includes('Debug'));
  } else if (platform === Platform.IOS && 'buildConfiguration' in buildProfile) {
    includesDevClient = Boolean(version && buildProfile.buildConfiguration === 'Debug');
  } else if (buildProfile.developmentClient) {
    includesDevClient = true;
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
