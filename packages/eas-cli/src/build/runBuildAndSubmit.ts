import { Platform, Workflow } from '@expo/eas-build-job';
import {
  AppVersionSource,
  BuildProfile,
  EasJson,
  EasJsonReader,
  SubmitProfile,
} from '@expo/eas-json';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

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
import { createSubmissionContextAsync } from '../submit/context';
import {
  exitWithNonZeroCodeIfSomeSubmissionsDidntFinish,
  submitAsync,
  waitToCompleteAsync as waitForSubmissionsToCompleteAsync,
} from '../submit/submit';
import { printSubmissionDetailsUrls } from '../submit/utils/urls';
import { checkBuildProfileConfigMatchesProjectConfigAsync } from '../update/utils';
import { printJsonOnlyOutput } from '../utils/json';
import { ProfileData, getProfilesAsync } from '../utils/profiles';
import { getVcsClient } from '../vcs';
import { prepareAndroidBuildAsync } from './android/build';
import { BuildRequestSender, waitForBuildEndAsync } from './build';
import { ensureProjectConfiguredAsync } from './configure';
import { BuildContext } from './context';
import { createBuildContextAsync } from './createContext';
import { prepareIosBuildAsync } from './ios/build';
import { LocalBuildOptions } from './local';
import { UserInputResourceClass } from './types';
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
  userInputResourceClass?: UserInputResourceClass;
  message?: string;
}

const platformToGraphQLResourceClassMapping: Record<
  Platform,
  Record<UserInputResourceClass, BuildResourceClass>
> = {
  [Platform.ANDROID]: {
    [UserInputResourceClass.DEFAULT]: BuildResourceClass.AndroidDefault,
    [UserInputResourceClass.LARGE]: BuildResourceClass.AndroidLarge,
  },
  [Platform.IOS]: {
    [UserInputResourceClass.DEFAULT]: BuildResourceClass.IosDefault,
    [UserInputResourceClass.LARGE]: BuildResourceClass.IosLarge,
  },
};

export async function runBuildAndSubmitAsync(projectDir: string, flags: BuildFlags): Promise<void> {
  await getVcsClient().ensureRepoExistsAsync();
  await ensureRepoIsCleanAsync(flags.nonInteractive);

  await ensureProjectConfiguredAsync({
    projectDir,
    nonInteractive: flags.nonInteractive,
  });
  const easJsonReader = new EasJsonReader(projectDir);
  const easJsonCliConfig: EasJson['cli'] = (await easJsonReader.getCliConfigAsync()) ?? {};

  const platforms = toPlatforms(flags.requestedPlatform);
  const buildProfiles = await getProfilesAsync({
    type: 'build',
    easJsonReader,
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

  // Check only first buildprofile (there should be only one unique one)
  // Warn only once
  if (buildProfiles.length > 0) {
    await checkBuildProfileConfigMatchesProjectConfigAsync(projectDir, buildProfiles[0]);
  }

  for (const buildProfile of buildProfiles) {
    const { build: maybeBuild, buildCtx } = await prepareAndStartBuildAsync({
      projectDir,
      flags,
      moreBuilds: platforms.length > 1,
      buildProfile,
      resourceClass:
        platformToGraphQLResourceClassMapping[buildProfile.platform][
          flags.userInputResourceClass ?? UserInputResourceClass.DEFAULT
        ],
      easJsonCliConfig,
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
      easJsonReader,
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
      startedBuild.build = await BuildQuery.withSubmissionsByIdAsync(startedBuild.build.id);
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
  const builds = await waitForBuildEndAsync({
    buildIds: startedBuilds.map(({ build }) => build.id),
    accountName,
  });
  if (!flags.json) {
    printBuildResults(builds);
  }

  const haveAllBuildsFailedOrCanceled = builds.every(
    build => build?.status && [BuildStatus.Errored, BuildStatus.Canceled].includes(build?.status)
  );
  if (haveAllBuildsFailedOrCanceled || !flags.autoSubmit) {
    if (flags.json) {
      printJsonOnlyOutput(builds);
    }
    exitWithNonZeroCodeIfSomeBuildsFailed(builds);
  } else {
    const completedSubmissions = await waitForSubmissionsToCompleteAsync(submissions);
    if (flags.json) {
      printJsonOnlyOutput(
        await Promise.all(
          builds
            .filter((i): i is BuildWithSubmissionsFragment => !!i)
            .map(build => BuildQuery.withSubmissionsByIdAsync(build.id))
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
}: {
  projectDir: string;
  flags: BuildFlags;
  moreBuilds: boolean;
  buildProfile: ProfileData<'build'>;
  resourceClass: BuildResourceClass;
  easJsonCliConfig: EasJson['cli'];
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
    projectId: build.project.id,
    profile: submitProfile,
    archiveFlags: { id: build.id },
    nonInteractive,
    env: buildProfile.env,
    credentialsCtx: buildCtx.credentialsCtx,
    applicationIdentifier: buildCtx.android?.applicationId ?? buildCtx.ios?.bundleIdentifier,
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
