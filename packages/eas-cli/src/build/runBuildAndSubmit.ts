import { ExpoConfig } from '@expo/config-types';
import { Env, Platform, Workflow } from '@expo/eas-build-job';
import {
  AppVersionSource,
  EasJson,
  EasJsonAccessor,
  EasJsonUtils,
  ResourceClass,
  SubmitProfile,
} from '@expo/eas-json';
import { LoggerLevel } from '@expo/logger';
import assert from 'assert';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { prepareAndroidBuildAsync } from './android/build';
import { BuildRequestSender, MaybeBuildFragment, waitForBuildEndAsync } from './build';
import { ensureProjectConfiguredAsync } from './configure';
import { BuildContext } from './context';
import { createBuildContextAsync } from './createContext';
import { evaluateConfigWithEnvVarsAsync } from './evaluateConfigWithEnvVarsAsync';
import { prepareIosBuildAsync } from './ios/build';
import { LocalBuildMode, LocalBuildOptions } from './local';
import { ensureExpoDevClientInstalledForDevClientBuildsAsync } from './utils/devClient';
import { printBuildResults, printLogsUrls } from './utils/printBuildInfo';
import { ensureRepoIsCleanAsync } from './utils/repository';
import { Analytics } from '../analytics/AnalyticsManager';
import { createAndLinkChannelAsync, doesChannelExistAsync } from '../channel/queries';
import { DynamicConfigContextFn } from '../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  BuildWithSubmissionsFragment,
  EnvironmentVariableEnvironment,
  SubmissionFragment,
} from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import { EnvironmentVariablesQuery } from '../graphql/queries/EnvironmentVariablesQuery';
import { toAppPlatform, toPlatform } from '../graphql/types/AppPlatform';
import Log, { learnMore } from '../log';
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
  isExpoUpdatesInstalledAsDevDependency,
  isExpoUpdatesInstalledOrAvailable,
  isUsingEASUpdate,
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
import { ensureEASUpdateIsConfiguredAsync } from '../update/configure';
import { Actor } from '../user/User';
import { downloadAndMaybeExtractAppAsync } from '../utils/download';
import { truthy } from '../utils/expodash/filter';
import { printJsonOnlyOutput } from '../utils/json';
import { ProfileData, getProfilesAsync } from '../utils/profiles';
import { Client } from '../vcs/vcs';

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
  buildLoggerLevel?: LoggerLevel;
  freezeCredentials: boolean;
  repack: boolean;
  environment?: EnvironmentVariableEnvironment;
}

export async function runBuildAndSubmitAsync(
  graphqlClient: ExpoGraphqlClient,
  analytics: Analytics,
  vcsClient: Client,
  projectDir: string,
  flags: BuildFlags,
  actor: Actor,
  getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn
): Promise<{
  buildIds: string[];
}> {
  await vcsClient.ensureRepoExistsAsync();
  await ensureRepoIsCleanAsync(vcsClient, flags.nonInteractive);

  await ensureProjectConfiguredAsync({
    projectDir,
    nonInteractive: flags.nonInteractive,
    vcsClient,
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
    projectDir,
  });

  for (const buildProfile of buildProfiles) {
    if (buildProfile.profile.image && ['default', 'stable'].includes(buildProfile.profile.image)) {
      Log.warn(
        `The "image" field in the build profile "${buildProfile.profileName}" is set to "${buildProfile.profile.image}". This tag is deprecated and will be removed in the future. Use other images or tags listed here: https://docs.expo.dev/build-reference/infrastructure/`
      );
    } else if (
      buildProfile.profile.image &&
      [
        'ubuntu-20.04-jdk-11-ndk-r19c',
        'ubuntu-20.04-jdk-8-ndk-r19c',
        'ubuntu-20.04-jdk-11-ndk-r21e',
        'ubuntu-20.04-jdk-8-ndk-r21e',
        'ubuntu-22.04-jdk-8-ndk-r21e',
        'ubuntu-20.04-jdk-11-ndk-r23b',
      ].includes(buildProfile.profile.image)
    ) {
      Log.warn(
        `The "image" field in the build profile "${buildProfile.profileName}" is set to "${
          buildProfile.profile.image
        }". This image is deprecated and will be removed on September 1st, 2024. ${learnMore(
          'https://expo.dev/changelog/2024/07-12-eas-build-upcoming-android-images-updates'
        )}`
      );
    }
  }

  await ensureExpoDevClientInstalledForDevClientBuildsAsync({
    projectDir,
    nonInteractive: flags.nonInteractive,
    buildProfiles,
    vcsClient,
  });

  const customBuildConfigMetadataByPlatform: { [p in AppPlatform]?: CustomBuildConfigMetadata } =
    {};
  for (const buildProfile of buildProfiles) {
    validateBuildProfileVersionSettings(buildProfile, easJsonCliConfig);
    const maybeMetadata = await validateCustomBuildConfigAsync({
      projectDir,
      profile: buildProfile.profile,
      vcsClient,
    });
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

    const { env } = await evaluateConfigWithEnvVarsAsync({
      flags,
      buildProfile: buildProfile.profile,
      graphqlClient,
      getProjectConfig: getDynamicPrivateProjectConfigAsync,
      opts: { env: buildProfile.profile.env },
    });

    Log.log(
      `Loaded "env" configuration for the "${buildProfile.profileName}" profile: ${
        env ? Object.keys(env).join(', ') : 'no environment variables specified'
      }. ${learnMore('https://docs.expo.dev/build-reference/variables/')}`
    );

    const { build: maybeBuild, buildCtx } = await prepareAndStartBuildAsync({
      projectDir,
      flags,
      moreBuilds: platforms.length > 1,
      buildProfile,
      easJsonCliConfig,
      actor,
      graphqlClient,
      analytics,
      vcsClient,
      getDynamicPrivateProjectConfigAsync,
      customBuildConfigMetadata: customBuildConfigMetadataByPlatform[platform],
      env,
    });
    if (maybeBuild) {
      startedBuilds.push({ build: maybeBuild, buildProfile });
    }
    buildCtxByPlatform[platform] = buildCtx;
  }

  if (flags.localBuildOptions.localBuildMode === LocalBuildMode.LOCAL_BUILD_PLUGIN) {
    return {
      buildIds: startedBuilds.map(({ build }) => build.id),
    };
  }

  if (flags.localBuildOptions.localBuildMode === LocalBuildMode.INTERNAL) {
    const startedBuild = await BuildQuery.byIdAsync(
      graphqlClient,
      nullthrows(process.env.EAS_BUILD_ID, 'EAS_BUILD_ID is not defined')
    );
    startedBuilds.push({ build: startedBuild, buildProfile: buildProfiles[0] });
  }

  if (!flags.localBuildOptions.localBuildMode) {
    Log.newLine();
    printLogsUrls(startedBuilds.map(startedBuild => startedBuild.build));
    Log.newLine();
  }

  const submissions: SubmissionFragment[] = [];
  if (flags.autoSubmit) {
    const submitProfiles = await getProfilesAsync({
      easJsonAccessor,
      platforms,
      profileName: flags.submitProfile,
      type: 'submit',
      projectDir,
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
        submitProfile,
        nonInteractive: flags.nonInteractive,
        selectedSubmitProfileName: flags.submitProfile,
      });
      startedBuild.build = await BuildQuery.withSubmissionsByIdAsync(
        graphqlClient,
        startedBuild.build.id
      );
      submissions.push(submission);
    }

    if (!flags.localBuildOptions.localBuildMode) {
      Log.newLine();
      printSubmissionDetailsUrls(submissions);
      Log.newLine();
    }
  }

  if (flags.localBuildOptions.localBuildMode) {
    return {
      buildIds: startedBuilds.map(({ build }) => build.id),
    };
  }

  if (!flags.wait) {
    if (flags.json) {
      printJsonOnlyOutput(startedBuilds.map(buildInfo => buildInfo.build));
    }
    return {
      buildIds: startedBuilds.map(({ build }) => build.id),
    };
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
  return {
    buildIds: startedBuilds.map(({ build }) => build.id),
  };
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
  vcsClient,
  getDynamicPrivateProjectConfigAsync,
  customBuildConfigMetadata,
  env,
}: {
  projectDir: string;
  flags: BuildFlags;
  moreBuilds: boolean;
  buildProfile: ProfileData<'build'>;
  easJsonCliConfig: EasJson['cli'];
  actor: Actor;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  vcsClient: Client;
  getDynamicPrivateProjectConfigAsync: DynamicConfigContextFn;
  customBuildConfigMetadata?: CustomBuildConfigMetadata;
  env: Env;
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
    vcsClient,
    getDynamicPrivateProjectConfigAsync,
    customBuildConfigMetadata,
    buildLoggerLevel: flags.buildLoggerLevel,
    freezeCredentials: flags.freezeCredentials,
    repack: flags.repack,
    env,
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

  if (buildProfile.profile.channel) {
    await validateExpoUpdatesInstalledAsProjectDependencyAsync({
      exp: buildCtx.exp,
      projectId: buildCtx.projectId,
      projectDir,
      vcsClient: buildCtx.vcsClient,
      sdkVersion: buildCtx.exp.sdkVersion,
      nonInteractive: flags.nonInteractive,
      buildProfile,
      env: buildProfile.profile.env,
    });
    if (isUsingEASUpdate(buildCtx.exp, buildCtx.projectId)) {
      const doesChannelExist = await doesChannelExistAsync(graphqlClient, {
        appId: buildCtx.projectId,
        channelName: buildProfile.profile.channel,
      });
      if (!doesChannelExist) {
        await createAndLinkChannelAsync(graphqlClient, {
          appId: buildCtx.projectId,
          channelName: buildProfile.profile.channel,
        });
      }
    }
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
  submitProfile,
  selectedSubmitProfileName,
  nonInteractive,
}: {
  build: BuildFragment;
  buildCtx: BuildContext<Platform>;
  moreBuilds: boolean;
  projectDir: string;
  submitProfile: SubmitProfile;
  selectedSubmitProfileName?: string;
  nonInteractive: boolean;
}): Promise<SubmissionFragment> {
  const platform = toPlatform(build.platform);
  const submissionCtx = await createSubmissionContextAsync({
    platform,
    projectDir,
    profile: submitProfile,
    archiveFlags: { id: build.id },
    nonInteractive,
    env: buildCtx.env,
    credentialsCtx: buildCtx.credentialsCtx,
    applicationIdentifier: buildCtx.android?.applicationId ?? buildCtx.ios?.bundleIdentifier,
    actor: buildCtx.user,
    graphqlClient: buildCtx.graphqlClient,
    analytics: buildCtx.analytics,
    projectId: buildCtx.projectId,
    exp: buildCtx.exp,
    vcsClient: buildCtx.vcsClient,
    isVerboseFastlaneEnabled: false,
    specifiedProfile: selectedSubmitProfileName,
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
  exp,
  projectId,
  projectDir,
  vcsClient,
  buildProfile,
  nonInteractive,
  sdkVersion,
  env,
}: {
  exp: ExpoConfig;
  projectId: string;
  projectDir: string;
  vcsClient: Client;
  buildProfile: ProfileData<'build'>;
  nonInteractive: boolean;
  sdkVersion?: string;
  env: Env | undefined;
}): Promise<void> {
  if (isExpoUpdatesInstalledOrAvailable(projectDir, sdkVersion)) {
    return;
  }

  if (isExpoUpdatesInstalledAsDevDependency(projectDir)) {
    Log.warn(
      `The build profile "${buildProfile.profileName}" uses the channel "${buildProfile.profile.channel}", but you've added "expo-updates" as a dev dependency. To make channels work for your builds, move "expo-updates" from dev dependencies to the main dependencies in your project.`
    );
  } else if (nonInteractive) {
    Log.warn(
      `The build profile "${buildProfile.profileName}" has specified the channel "${buildProfile.profile.channel}", but the "expo-updates" package hasn't been installed. To use channels for your builds, install the "expo-updates" package by running "npx expo install expo-updates" followed by "eas update:configure".`
    );
  } else {
    Log.warn(
      `The build profile "${buildProfile.profileName}" specifies the channel "${buildProfile.profile.channel}", but the "expo-updates" package is missing. To use channels in your builds, install the "expo-updates" package and run "eas update:configure".`
    );
    const installExpoUpdates = await confirmAsync({
      message: `Would you like to install the "expo-updates" package and configure EAS Update now?`,
    });
    if (installExpoUpdates) {
      await ensureEASUpdateIsConfiguredAsync({
        exp,
        projectId,
        projectDir,
        platform: RequestedPlatform.All,
        vcsClient,
        env,
      });
      Log.withTick('Installed expo-updates and configured EAS Update.');
      throw new Error('Command must be re-run to pick up new updates configuration.');
    }
  }
}

function isEnvironment(env: string): env is EnvironmentVariableEnvironment {
  if (
    Object.values(EnvironmentVariableEnvironment).includes(env as EnvironmentVariableEnvironment)
  ) {
    return true;
  }
  return false;
}

async function resolveEnvVarsAsync({
  flags,
  buildProfile,
  graphqlClient,
  projectId,
}: {
  flags: BuildFlags;
  buildProfile: ProfileData<'build'>;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
}): Promise<Record<string, string>> {
  const environment =
    flags.environment ?? buildProfile.profile.environment ?? process.env.EAS_CURRENT_ENVIRONMENT;

  if (!environment || !isEnvironment(environment)) {
    return {};
  }

  try {
    const environmentVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(
      graphqlClient,
      {
        appId: projectId,
        environment,
      }
    );
    const envVars = Object.fromEntries(
      environmentVariables
        .filter(({ name, value }) => name && value)
        .map(({ name, value }) => [name, value])
    ) as Record<string, string>;

    return envVars;
  } catch (e) {
    Log.error('Failed to pull the env file');
    Log.error(e);
  }

  return {};
}
