import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import JsonFileModule from '@expo/json-file';
import resolveFrom from 'resolve-from';
import { v4 as uuidv4 } from 'uuid';

import { TrackingContext } from '../analytics/common.js';
import { Analytics, BuildEvent } from '../analytics/events.js';
import { CredentialsContext } from '../credentials/context.js';
import { BuildResourceClass } from '../graphql/generated.js';
import { getExpoConfig } from '../project/expoConfig.js';
import { getProjectAccountName, getProjectIdAsync } from '../project/projectUtils.js';
import { resolveWorkflowAsync } from '../project/workflow.js';
import { findAccountByName } from '../user/Account.js';
import { ensureLoggedInAsync } from '../user/actions.js';
import { createAndroidContextAsync } from './android/build.js';
import { BuildContext, CommonContext } from './context.js';
import { createIosContextAsync } from './ios/build.js';
import { LocalBuildOptions } from './local.js';

const JsonFile = JsonFileModule.default;

export async function createBuildContextAsync<T extends Platform>({
  buildProfileName,
  buildProfile,
  clearCache = false,
  localBuildOptions,
  nonInteractive = false,
  platform,
  projectDir,
  resourceClass,
}: {
  buildProfileName: string;
  buildProfile: BuildProfile<T>;
  clearCache: boolean;
  localBuildOptions: LocalBuildOptions;
  nonInteractive: boolean;
  platform: T;
  projectDir: string;
  resourceClass: BuildResourceClass;
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
    env: buildProfile.env,
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
  };
  Analytics.logEvent(BuildEvent.BUILD_COMMAND, trackingCtx);

  const commonContext: CommonContext<T> = {
    accountName,
    buildProfile,
    buildProfileName,
    resourceClass,
    clearCache,
    credentialsCtx,
    exp,
    localBuildOptions,
    nonInteractive,
    platform,
    projectDir,
    projectId,
    projectName,
    trackingCtx,
    user,
    workflow,
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
