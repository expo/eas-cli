import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJson, ResourceClass } from '@expo/eas-json';
import JsonFile from '@expo/json-file';
import { LoggerLevel } from '@expo/logger';
import { resolvePackageManager } from '@expo/package-manager';
import getenv from 'getenv';
import resolveFrom from 'resolve-from';
import { v4 as uuidv4 } from 'uuid';

import { createAndroidContextAsync } from './android/build';
import { BuildContext, CommonContext } from './context';
import { createIosContextAsync } from './ios/build';
import { LocalBuildOptions } from './local';
import { resolveBuildResourceClassAsync } from './utils/resourceClass';
import { Analytics, AnalyticsEventProperties, BuildEvent } from '../analytics/AnalyticsManager';
import { DynamicConfigContextFn } from '../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CredentialsContext } from '../credentials/context';
import { CustomBuildConfigMetadata } from '../project/customBuildConfig';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';
import { resolveWorkflowAsync } from '../project/workflow';
import { Actor } from '../user/User';
import { Client } from '../vcs/vcs';

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
  resourceClassFlag,
  message,
  actor,
  graphqlClient,
  analytics,
  vcsClient,
  getDynamicPrivateProjectConfigAsync,
  customBuildConfigMetadata,
  buildLoggerLevel,
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
  resourceClassFlag?: ResourceClass;
  message?: string;
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  vcsClient: Client;
  getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn;
  customBuildConfigMetadata?: CustomBuildConfigMetadata;
  buildLoggerLevel?: LoggerLevel;
}): Promise<BuildContext<T>> {
  const { exp, projectId } = await getDynamicPrivateProjectConfigAsync({ env: buildProfile.env });
  const projectName = exp.slug;
  const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
  const workflow = await resolveWorkflowAsync(projectDir, platform, vcsClient);
  const accountId = account.id;
  const runFromCI = getenv.boolish('CI', false);
  const developmentClient =
    buildProfile.developmentClient ??
    (platform === Platform.ANDROID
      ? (buildProfile as BuildProfile<Platform.ANDROID>)?.gradleCommand === ':app:assembleDebug'
      : (buildProfile as BuildProfile<Platform.IOS>)?.buildConfiguration === 'Debug') ??
    false;

  const requiredPackageManager = resolvePackageManager(projectDir);

  const credentialsCtx = new CredentialsContext({
    projectInfo: { exp, projectId },
    nonInteractive,
    projectDir,
    user: actor,
    graphqlClient,
    analytics,
    env: buildProfile.env,
    easJsonCliConfig,
    vcsClient,
  });

  const devClientProperties = getDevClientEventProperties({
    platform,
    projectDir,
    buildProfile,
  });
  const analyticsEventProperties = {
    tracking_id: uuidv4(),
    platform,
    ...(exp.sdkVersion && { sdk_version: exp.sdkVersion }),
    ...(accountId && { account_id: accountId }),
    project_id: projectId,
    project_type: workflow,
    ...devClientProperties,
    no_wait: noWait,
    run_from_ci: runFromCI,
  };
  analytics.logEvent(BuildEvent.BUILD_COMMAND, analyticsEventProperties);

  const resourceClass = await resolveBuildResourceClassAsync(
    buildProfile,
    platform,
    resourceClassFlag
  );

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
    analyticsEventProperties,
    user: actor,
    graphqlClient,
    analytics,
    vcsClient,
    workflow,
    message,
    runFromCI,
    customBuildConfigMetadata,
    developmentClient,
    requiredPackageManager,
    loggerLevel: buildLoggerLevel,
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
}): Partial<AnalyticsEventProperties> {
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
