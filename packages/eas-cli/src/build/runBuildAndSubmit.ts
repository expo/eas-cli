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
import {
  CustomBuildConfigMetadata,
  validateCustomBuildConfigAsync,
} from '../project/customBuildConfig';
import { checkExpoSdkIsSupportedAsync } from '../project/expoSdk';
import { validateMetroConfigForManagedWorkflowAsync } from '../project/metroConfig';
import {
  installExpoUpdatesAsync,
  isExpoUpdatesInstalledAsDevDependency,
  isExpoUpdatesInstalledOrAvailable,
  validateAppVersionRuntimePolicySupportAsync,
} from '../project/projectUtils';
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

export async function runBuildAndSubmitAsync(
  graphqlClient: ExpoGraphqlClient,
  analytics: Analytics,
  projectDir: string,
  flags: BuildFlags,
  actor: Actor,
  getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn
): Promise<void> {
  await getVcsClient().ensureRepoExistsAsync();
  await ensureRepoIsCleanAsync(flags.nonInteractive);

  await ensureProjectConfiguredAsync({
    projectDir,
    nonInteractive: flags.nonInteractive,
  });
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
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

  const customBuildConfigMetadataByPlatform: { [p in AppPlatform]?: CustomBuildConfigMetadata } =
    {};
  for (const buildProfile of buildProfiles) {
    validateBuildProfileVersionSettings(buildProfile, easJsonCliConfig);
    const maybeMetadata = await validateCustomBuildConfigAsync(projectDir, buildProfile.profile);
    if (maybeMetadata) {
      customBuildConfigMetadataByPlatform[toAppPlatform(buildProfile.platform)] = maybeMetadata;
    }
  }

  const startedBuilds: {
    build: BuildWithSubmissionsFragment | BuildFragment;
    buildProfile: ProfileData<'build'>;
  }[] = [];
  const buildCtxByPlatform: { [p in AppPlatform]?: BuildContext<Platform> } = {};

  for (const buildProfile of buildProfiles) {
    const platform = toAppPlatform(buildProfile.platform);
    const { build: maybeBuild, buildCtx } = await prepareAndStartBuildAsync({
      projectDir,
      flags,
      moreBuilds: platforms.length > 1,
      buildProfile,
      easJsonCliConfig,
      actor,
      graphqlClient,
      analytics,
      getDynamicPrivateProjectConfigAsync,
      customBuildConfigMetadata: customBuildConfigMetadataByPlatform[platform],
    });
    if (maybeBuild) {
      startedBuilds.push({ build: maybeBuild, buildProfile });
    }
    buildCtxByPlatform[platform] = buildCtx;
  }

  if (flags.localBuildOptions.localBuildMode) {
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
    projectDir,
    nonInteractive: flags.nonInteractive,
  });
  if (!flags.json) {
    printBuildResults(builds);
  }

  const haveAllBuildsFailedOrCanceled = builds.every(
    build =>
      build?.status &&
      [BuildStatus.Errored, BuildStatus.Canceled, BuildStatus.PendingCancel].includes(build?.status)
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
  easJsonCliConfig,
  actor,
  graphqlClient,
  analytics,
  getDynamicPrivateProjectConfigAsync,
  customBuildConfigMetadata,
}: {
  projectDir: string;
  flags: BuildFlags;
  moreBuilds: boolean;
  buildProfile: ProfileData<'build'>;
  easJsonCliConfig: EasJson['cli'];
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn;
  customBuildConfigMetadata?: CustomBuildConfigMetadata;
}): Promise<{ build: BuildFragment | undefined; buildCtx: BuildContext<Platform> }> {
  const buildCtx = await createBuildContextAsync({
    buildProfileName: buildProfile.profileName,
    resourceClassFlag: flags.resourceClass,
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
    getDynamicPrivateProjectConfigAsync,
    customBuildConfigMetadata,
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
  if (buildProfile.profile.channel) {
    await validateExpoUpdatesInstalledAsProjectDependencyAsync({
      projectDir,
      sdkVersion: buildCtx.exp.sdkVersion,
      nonInteractive: flags.nonInteractive,
      buildProfile,
    });
  }

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

async function validateExpoUpdatesInstalledAsProjectDependencyAsync({
  projectDir,
  buildProfile,
  nonInteractive,
  sdkVersion,
}: {
  projectDir: string;
  buildProfile: ProfileData<'build'>;
  nonInteractive: boolean;
  sdkVersion?: string;
}): Promise<void> {
  if (isExpoUpdatesInstalledOrAvailable(projectDir, sdkVersion)) {
    return;
  }

  if (isExpoUpdatesInstalledAsDevDependency(projectDir)) {
    Log.warn(
      `Channel "${buildProfile.profile.channel}" is specified for build profile "${buildProfile.profileName}" but expo-updates is installed as dev dependency. Please remove expo-updates from your dev dependencies and add it as dependency to your project.`
    );
  } else if (nonInteractive) {
    Log.warn(
      `Channel "${buildProfile.profile.channel}" is specified for build profile "${buildProfile.profileName}" but expo-updates is not installed. Please install expo-updates to use channels for your builds. Run "npx expo install expo-updates" to install expo-updates package.`
    );
  } else {
    Log.warn(
      `Channel "${buildProfile.profile.channel}" is specified for build profile "${buildProfile.profileName}" but expo-updates is not installed.`
    );
    const installExpoUpdates = await confirmAsync({
      message: `Would you like to install expo-updates?`,
    });
    if (installExpoUpdates) {
      await installExpoUpdatesAsync(projectDir, { silent: false });
      Log.withTick('Installed expo updates');
    }
  }
}
