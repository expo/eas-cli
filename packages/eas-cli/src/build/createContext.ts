import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJson } from '@expo/eas-json';
import JsonFile from '@expo/json-file';
import getenv from 'getenv';
import resolveFrom from 'resolve-from';
import { v4 as uuidv4 } from 'uuid';

import { TrackingContext } from '../analytics/common';
import { Analytics, BuildEvent } from '../analytics/events';
import { CredentialsContext } from '../credentials/context';
import { BuildResourceClass } from '../graphql/generated';
import { getExpoConfig } from '../project/expoConfig';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import { resolveWorkflowAsync } from '../project/workflow';
import { Actor } from '../user/User';
import { createAndroidContextAsync } from './android/build';
import { BuildContext, CommonContext } from './context';
import { createIosContextAsync } from './ios/build';
import { LocalBuildOptions } from './local';

export async function createBuildContextAsync<T extends Platform>({
  buildProfileName,
  buildProfile,
  easJsonCliConfig,
  clearCache = false,
  localBuildOptions,
  nonInteractive,
  noWait,
  platform,
  projectDir,
  resourceClass,
  message,
  actor,
  projectId,
}: {
  buildProfileName: string;
  buildProfile: BuildProfile<T>;
  easJsonCliConfig: EasJson['cli'];
  clearCache: boolean;
  localBuildOptions: LocalBuildOptions;
  nonInteractive: boolean;
  noWait: boolean;
  platform: T;
  projectDir: string;
  resourceClass: BuildResourceClass;
  message?: string;
  actor: Actor;
  projectId: string;
}): Promise<BuildContext<T>> {
  const exp = getExpoConfig(projectDir, { env: buildProfile.env });

  const projectName = exp.slug;
  const account = await getOwnerAccountForProjectIdAsync(projectId);
  const workflow = await resolveWorkflowAsync(projectDir, platform);
  const accountId = account.id;
  const runFromCI = getenv.boolish('CI', false);

  const credentialsCtx = new CredentialsContext({
    projectInfo: { exp, projectId },
    nonInteractive,
    projectDir,
    user: actor,
    env: buildProfile.env,
    easJsonCliConfig,
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
    project_id: projectId,
    project_type: workflow,
    ...devClientProperties,
    no_wait: noWait,
    run_from_ci: runFromCI,
  };
  Analytics.logEvent(BuildEvent.BUILD_COMMAND, trackingCtx);

  const commonContext: CommonContext<T> = {
    accountName: account.name,
    buildProfile,
    buildProfileName,
    resourceClass,
    easJsonCliConfig,
    clearCache,
    credentialsCtx,
    exp,
    localBuildOptions,
    nonInteractive,
    noWait,
    platform,
    projectDir,
    projectId,
    projectName,
    trackingCtx,
    user: actor,
    workflow,
    message,
    runFromCI,
  };
  if (platform === Platform.ANDROID) {
    const common = commonContext as CommonContext<Platform.ANDROID>;
    return {
      ...common,
      android: await createAndroidContextAsync(common),
    } as BuildContext<T>;
  } else {
    const common = commonContext as CommonContext<Platform.IOS>;
    return {
      ...common,
      ios: await createIosContextAsync(common),
    } as BuildContext<T>;
  }
}

function getDevClientEventProperties({
  platform,
  projectDir,
  buildProfile,
}: {
  platform: Platform;
  projectDir: string;
  buildProfile: BuildProfile;
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
