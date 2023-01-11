import { Platform, Workflow } from '@expo/eas-build-job';
import {
  AppVersionSource,
  BuildProfile,
  EasJson,
  EasJsonAccessor,
  EasJsonUtils,
  ResourceClass,
  SubmitProfile,
} from '@expo/eas-json';
import assert from 'assert';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { Analytics } from '../analytics/AnalyticsManager';
import { DynamicConfigContextFn } from '../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  BuildFragment,
  BuildResourceClass,
  BuildStatus,
  BuildWithSubmissionsFragment,
  SubmissionFragment,
} from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import { toAppPlatform, toPlatform } from '../graphql/types/AppPlatform';
import Log from '../log';
import {
  RequestedPlatform,
  appPlatformDisplayNames,
  appPlatformEmojis,
  toPlatforms,
} from '../platform';
import { checkExpoSdkIsSupportedAsync } from '../project/expoSdk';
import { validateMetroConfigForManagedWorkflowAsync } from '../project/metroConfig';
import { validateAppVersionRuntimePolicySupportAsync } from '../project/projectUtils';
import {
  validateAppConfigForRemoteVersionSource,
  validateBuildProfileVersionSettings,
} from '../project/remoteVersionSource';
import { confirmAsync } from '../prompts';
import { runAsync } from '../run/run';
import { isRunnableOnSimulatorOrEmulator } from '../run/utils';
import { createSubmissionContextAsync } from '../submit/context';
import {
  exitWithNonZeroCodeIfSomeSubmissionsDidntFinish,
  submitAsync,
  waitToCompleteAsync as waitForSubmissionsToCompleteAsync,
} from '../submit/submit';
import { printSubmissionDetailsUrls } from '../submit/utils/urls';
import { validateBuildProfileConfigMatchesProjectConfigAsync } from '../update/utils';
import { Actor } from '../user/User';
import { downloadAndMaybeExtractAppAsync } from '../utils/download';
import { truthy } from '../utils/expodash/filter';
import { printJsonOnlyOutput } from '../utils/json';
import { ProfileData, getProfilesAsync } from '../utils/profiles';
import { getVcsClient } from '../vcs';
import { prepareAndroidBuildAsync } from './android/build';
import { BuildRequestSender, MaybeBuildFragment, waitForBuildEndAsync } from './build';
import { ensureProjectConfiguredAsync } from './configure';
import { BuildContext } from './context';
import { createBuildContextAsync } from './createContext';
import { prepareIosBuildAsync } from './ios/build';
import { LocalBuildOptions } from './local';
import { ensureExpoDevClientInstalledForDevClientBuildsAsync } from './utils/devClient';
import { printBuildResults, printLogsUrls } from './utils/printBuildInfo';
import { ensureRepoIsCleanAsync } from './utils/repository';

let metroConfigValidated = false;
let sdkVersionChecked = false;

export interface BuildFlags {
  requestedPlatform: RequestedPlatform;
  profile?: string;
  nonInteractive: boolean;
  wait: boolean;
  clearCache: boolean;
  json: boolean;
  autoSubmit: boolean;
  submitProfile?: string;
  localBuildOptions: LocalBuildOptions;
  resourceClass?: ResourceClass;
  message?: string;
}

const iosResourceClassToBuildResourceClassMapping: Record<ResourceClass, BuildResourceClass> = {
  [ResourceClass.DEFAULT]: BuildResourceClass.IosDefault,
  [ResourceClass.LARGE]: BuildResourceClass.IosLarge,
  [ResourceClass.M1_EXPERIMENTAL]: BuildResourceClass.IosM1Large,
  [ResourceClass.M1_MEDIUM]: BuildResourceClass.IosM1Medium,
  [ResourceClass.M1_LARGE]: BuildResourceClass.IosM1Large,
  [ResourceClass.INTEL_MEDIUM]: BuildResourceClass.IosIntelMedium,
  [ResourceClass.MEDIUM]: BuildResourceClass.IosMedium,
};

const androidResourceClassToBuildResourceClassMapping: Record<
  Exclude<
    ResourceClass,
    | ResourceClass.M1_EXPERIMENTAL
    | ResourceClass.M1_MEDIUM
    | ResourceClass.M1_LARGE
    | ResourceClass.INTEL_MEDIUM
  >,
  BuildResourceClass
> = {
  [ResourceClass.DEFAULT]: BuildResourceClass.AndroidDefault,
  [ResourceClass.LARGE]: BuildResourceClass.AndroidLarge,
  [ResourceClass.MEDIUM]: BuildResourceClass.AndroidMedium,
};

function resolveBuildResourceClass(
  profile: ProfileData<'build'>,
  resourceClassFlag?: ResourceClass
): BuildResourceClass {
  if (
    profile.platform !== Platform.IOS &&
    resourceClassFlag &&
    [
      ResourceClass.M1_EXPERIMENTAL,
      ResourceClass.M1_MEDIUM,
      ResourceClass.M1_LARGE,
      ResourceClass.INTEL_MEDIUM,
    ].includes(resourceClassFlag)
  ) {
    throw new Error(`Resource class ${resourceClassFlag} is only available for iOS builds`);
  }

  const profileResourceClass = profile.profile.resourceClass;
  if (profileResourceClass && resourceClassFlag && resourceClassFlag !== profileResourceClass) {
    Log.warn(
      `Build profile specifies the "${profileResourceClass}" resource class but you passed "${resourceClassFlag}" to --resource-class.\nUsing the  "${resourceClassFlag}" as the override.`
    );
  }
  const resourceClass = resourceClassFlag ?? profileResourceClass ?? ResourceClass.DEFAULT;

  if (profile.platform === Platform.IOS && resourceClass === ResourceClass.M1_EXPERIMENTAL) {
    Log.warn(`Resource class ${chalk.bold('m1-experimental')} is deprecated.`);
  }
  if (
    profile.platform === Platform.IOS &&
    [ResourceClass.LARGE, ResourceClass.M1_LARGE].includes(resourceClass)
  ) {
    Log.warn(
      `Large resource classes are not available for iOS builds yet. Your build will use the medium resource class..`
    );
  }

  return profile.platform === Platform.ANDROID
    ? androidResourceClassToBuildResourceClassMapping[
        resourceClass as Exclude<
          ResourceClass,
          | ResourceClass.M1_EXPERIMENTAL
          | ResourceClass.M1_MEDIUM
          | ResourceClass.M1_LARGE
          | ResourceClass.INTEL_MEDIUM
        >
      ]
    : iosResourceClassToBuildResourceClassMapping[resourceClass];
}

export async function runBuildAndSubmitAsync(
  graphqlClient: ExpoGraphqlClient,
  analytics: Analytics,
  projectDir: string,
  flags: BuildFlags,
  actor: Actor,
  getDynamicProjectConfigAsync: DynamicConfigContextFn
): Promise<void> {
  await getVcsClient().ensureRepoExistsAsync();
  await ensureRepoIsCleanAsync(flags.nonInteractive);

  await ensureProjectConfiguredAsync({
    projectDir,
    nonInteractive: flags.nonInteractive,
  });
  const easJsonAccessor = new EasJsonAccessor(projectDir);
  const easJsonCliConfig: EasJson['cli'] =
    (await EasJsonUtils.getCliConfigAsync(easJsonAccessor)) ?? {};

  const platforms = toPlatforms(flags.requestedPlatform);
  const buildProfiles = await getProfilesAsync({
    type: 'build',
    easJsonAccessor,
    platforms,
    profileName: flags.profile ?? undefined,
  });

  await ensureExpoDevClientInstalledForDevClientBuildsAsync({
    projectDir,
    nonInteractive: flags.nonInteractive,
    buildProfiles,
  });

  for (const buildProfile of buildProfiles) {
    validateBuildProfileVersionSettings(buildProfile, easJsonCliConfig);
  }

  const startedBuilds: {
    build: BuildWithSubmissionsFragment | BuildFragment;
    buildProfile: ProfileData<'build'>;
  }[] = [];
  const buildCtxByPlatform: { [p in AppPlatform]?: BuildContext<Platform> } = {};

  for (const buildProfile of buildProfiles) {
    const { build: maybeBuild, buildCtx } = await prepareAndStartBuildAsync({
      projectDir,
      flags,
      moreBuilds: platforms.length > 1,
      buildProfile,
      resourceClass: resolveBuildResourceClass(buildProfile, flags.resourceClass),
      easJsonCliConfig,
      actor,
      graphqlClient,
      analytics,
      getDynamicProjectConfigAsync,
    });
    if (maybeBuild) {
      startedBuilds.push({ build: maybeBuild, buildProfile });
    }
    buildCtxByPlatform[toAppPlatform(buildProfile.platform)] = buildCtx;
  }

  if (flags.localBuildOptions.enable) {
    return;
  }

  Log.newLine();
  printLogsUrls(startedBuilds.map(startedBuild => startedBuild.build));
  Log.newLine();

  const submissions: SubmissionFragment[] = [];
  if (flags.autoSubmit) {
    const submitProfiles = await getProfilesAsync({
      easJsonAccessor,
      platforms,
      profileName: flags.submitProfile,
      type: 'submit',
    });
    for (const startedBuild of startedBuilds) {
      const submitProfile = nullthrows(
        submitProfiles.find(
          ({ platform }) => toAppPlatform(platform) === startedBuild.build.platform
        )
      ).profile;
      const submission = await prepareAndStartSubmissionAsync({
        build: startedBuild.build,
        buildCtx: nullthrows(buildCtxByPlatform[startedBuild.build.platform]),
        moreBuilds: startedBuilds.length > 1,
        projectDir,
        buildProfile: startedBuild.buildProfile.profile,
        submitProfile,
        nonInteractive: flags.nonInteractive,
      });
      startedBuild.build = await BuildQuery.withSubmissionsByIdAsync(
        graphqlClient,
        startedBuild.build.id
      );
      submissions.push(submission);
    }

    Log.newLine();
    printSubmissionDetailsUrls(submissions);
    Log.newLine();
  }

  if (!flags.wait) {
    if (flags.json) {
      printJsonOnlyOutput(startedBuilds.map(buildInfo => buildInfo.build));
    }
    return;
  }

  const { accountName } = Object.values(buildCtxByPlatform)[0];
  const builds = await waitForBuildEndAsync(graphqlClient, {
    buildIds: startedBuilds.map(({ build }) => build.id),
    accountName,
  });
  if (!flags.json) {
    printBuildResults(builds);
  }

  const haveAllBuildsFailedOrCanceled = builds.every(
    build => build?.status && [BuildStatus.Errored, BuildStatus.Canceled].includes(build?.status)
  );

  await maybeDownloadAndRunSimulatorBuildsAsync(builds, flags);

  if (haveAllBuildsFailedOrCanceled || !flags.autoSubmit) {
    if (flags.json) {
      printJsonOnlyOutput(builds);
    }
    exitWithNonZeroCodeIfSomeBuildsFailed(builds);
  } else {
    const completedSubmissions = await waitForSubmissionsToCompleteAsync(
      graphqlClient,
      submissions
    );
    if (flags.json) {
      printJsonOnlyOutput(
        await Promise.all(
          builds
            .filter((i): i is BuildWithSubmissionsFragment => !!i)
            .map(build => BuildQuery.withSubmissionsByIdAsync(graphqlClient, build.id))
        )
      );
    }
    exitWithNonZeroCodeIfSomeSubmissionsDidntFinish(completedSubmissions);
  }
}

async function prepareAndStartBuildAsync({
  projectDir,
  flags,
  moreBuilds,
  buildProfile,
  resourceClass,
  easJsonCliConfig,
  actor,
  graphqlClient,
  analytics,
  getDynamicProjectConfigAsync,
}: {
  projectDir: string;
  flags: BuildFlags;
  moreBuilds: boolean;
  buildProfile: ProfileData<'build'>;
  resourceClass: BuildResourceClass;
  easJsonCliConfig: EasJson['cli'];
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  getDynamicProjectConfigAsync: DynamicConfigContextFn;
}): Promise<{ build: BuildFragment | undefined; buildCtx: BuildContext<Platform> }> {
  const buildCtx = await createBuildContextAsync({
    buildProfileName: buildProfile.profileName,
    resourceClass,
    clearCache: flags.clearCache,
    buildProfile: buildProfile.profile,
    nonInteractive: flags.nonInteractive,
    noWait: !flags.wait,
    platform: buildProfile.platform,
    projectDir,
    localBuildOptions: flags.localBuildOptions,
    easJsonCliConfig,
    message: flags.message,
    actor,
    graphqlClient,
    analytics,
    getDynamicProjectConfigAsync,
  });

  if (moreBuilds) {
    Log.newLine();
    const appPlatform = toAppPlatform(buildProfile.platform);
    Log.log(
      `${appPlatformEmojis[appPlatform]} ${chalk.bold(
        `${appPlatformDisplayNames[appPlatform]} build`
      )}`
    );
  }

  await validateBuildProfileConfigMatchesProjectConfigAsync(
    buildCtx.exp,
    buildProfile,
    buildCtx.projectId,
    flags.nonInteractive
  );

  await validateAppVersionRuntimePolicySupportAsync(buildCtx.projectDir, buildCtx.exp);
  if (easJsonCliConfig?.appVersionSource === AppVersionSource.REMOTE) {
    validateAppConfigForRemoteVersionSource(buildCtx.exp, buildProfile.platform);
  }
  if (buildCtx.workflow === Workflow.MANAGED) {
    if (!sdkVersionChecked) {
      await checkExpoSdkIsSupportedAsync(buildCtx);
      sdkVersionChecked = true;
    }
    if (!metroConfigValidated) {
      await validateMetroConfigForManagedWorkflowAsync(buildCtx);
      metroConfigValidated = true;
    }
  }

  const build = await startBuildAsync(buildCtx);
  return {
    build,
    buildCtx,
  };
}

async function startBuildAsync(ctx: BuildContext<Platform>): Promise<BuildFragment | undefined> {
  let sendBuildRequestAsync: BuildRequestSender;
  if (ctx.platform === Platform.ANDROID) {
    sendBuildRequestAsync = await prepareAndroidBuildAsync(ctx as BuildContext<Platform.ANDROID>);
  } else {
    sendBuildRequestAsync = await prepareIosBuildAsync(ctx as BuildContext<Platform.IOS>);
  }
  return await sendBuildRequestAsync();
}

async function prepareAndStartSubmissionAsync({
  build,
  buildCtx,
  moreBuilds,
  projectDir,
  buildProfile,
  submitProfile,
  nonInteractive,
}: {
  build: BuildFragment;
  buildCtx: BuildContext<Platform>;
  moreBuilds: boolean;
  projectDir: string;
  buildProfile: BuildProfile;
  submitProfile: SubmitProfile;
  nonInteractive: boolean;
}): Promise<SubmissionFragment> {
  const platform = toPlatform(build.platform);
  const submissionCtx = await createSubmissionContextAsync({
    platform,
    projectDir,
    profile: submitProfile,
    archiveFlags: { id: build.id },
    nonInteractive,
    env: buildProfile.env,
    credentialsCtx: buildCtx.credentialsCtx,
    applicationIdentifier: buildCtx.android?.applicationId ?? buildCtx.ios?.bundleIdentifier,
    actor: buildCtx.user,
    graphqlClient: buildCtx.graphqlClient,
    analytics: buildCtx.analytics,
    projectId: buildCtx.projectId,
    exp: buildCtx.exp,
  });

  if (moreBuilds) {
    Log.newLine();
    Log.log(
      `${appPlatformEmojis[build.platform]} ${chalk.bold(
        `${appPlatformDisplayNames[build.platform]} submission`
      )}`
    );
  }

  return await submitAsync(submissionCtx);
}

function exitWithNonZeroCodeIfSomeBuildsFailed(maybeBuilds: (BuildFragment | null)[]): void {
  const failedBuilds = (maybeBuilds.filter(i => i) as BuildFragment[]).filter(
    i => i.status === BuildStatus.Errored
  );
  if (failedBuilds.length > 0) {
    process.exit(1);
  }
}

async function downloadAndRunAsync(build: BuildFragment): Promise<void> {
  assert(build.artifacts?.applicationArchiveUrl);
  const buildPath = await downloadAndMaybeExtractAppAsync(
    build.artifacts.applicationArchiveUrl,
    build.platform
  );
  await runAsync(buildPath, build.platform);
}

async function maybeDownloadAndRunSimulatorBuildsAsync(
  builds: MaybeBuildFragment[],
  flags: BuildFlags
): Promise<void> {
  const simBuilds = builds.filter(truthy).filter(isRunnableOnSimulatorOrEmulator);

  if (simBuilds.length > 0 && !flags.autoSubmit && !flags.nonInteractive) {
    for (const simBuild of simBuilds) {
      if (simBuild.platform === AppPlatform.Android || process.platform === 'darwin') {
        Log.newLine();
        const confirm = await confirmAsync({
          message: `Install and run the ${
            simBuild.platform === AppPlatform.Android ? 'Android' : 'iOS'
          } build on ${simBuild.platform === AppPlatform.Android ? 'an emulator' : 'a simulator'}?`,
        });
        if (confirm) {
          await downloadAndRunAsync(simBuild);
        }
      }
    }
  }
}
