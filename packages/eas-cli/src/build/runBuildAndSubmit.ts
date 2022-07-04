import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile, EasJsonReader, SubmitProfile } from '@expo/eas-json';
import chalk from 'chalk';

import {
  AppPlatform,
  BuildFragment,
  BuildResourceClass,
  BuildStatus,
  SubmissionFragment,
} from '../graphql/generated.js';
import { toAppPlatform, toPlatform } from '../graphql/types/AppPlatform.js';
import Log from '../log.js';
import {
  RequestedPlatform,
  appPlatformDisplayNames,
  appPlatformEmojis,
  toPlatforms,
} from '../platform.js';
import { checkExpoSdkIsSupportedAsync } from '../project/expoSdk.js';
import { validateMetroConfigForManagedWorkflowAsync } from '../project/metroConfig.js';
import { createSubmissionContextAsync } from '../submit/context.js';
import {
  submitAsync,
  waitToCompleteAsync as waitForSubmissionsToCompleteAsync,
} from '../submit/submit.js';
import { printSubmissionDetailsUrls } from '../submit/utils/urls.js';
import { printJsonOnlyOutput } from '../utils/json.js';
import { nullthrows } from '../utils/nullthrows.js';
import { ProfileData, getProfilesAsync } from '../utils/profiles.js';
import { getVcsClient } from '../vcs/index.js';
import { prepareAndroidBuildAsync } from './android/build.js';
import { BuildRequestSender, waitForBuildEndAsync } from './build.js';
import { ensureProjectConfiguredAsync } from './configure.js';
import { BuildContext } from './context.js';
import { createBuildContextAsync } from './createContext.js';
import { prepareIosBuildAsync } from './ios/build.js';
import { LocalBuildOptions } from './local.js';
import { UserInputResourceClass } from './types.js';
import { ensureExpoDevClientInstalledForDevClientBuildsAsync } from './utils/devClient.js';
import { printBuildResults, printLogsUrls } from './utils/printBuildInfo.js';
import { ensureRepoIsCleanAsync } from './utils/repository.js';

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

  const startedBuilds: {
    build: BuildFragment;
    buildProfile: ProfileData<'build'>;
  }[] = [];
  const buildCtxByPlatform: { [p in AppPlatform]?: BuildContext<Platform> } = {};

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
  printBuildResults(builds, flags.json);

  const haveAllBuildsFailedOrCanceled = builds.every(
    build => build?.status && [BuildStatus.Errored, BuildStatus.Canceled].includes(build?.status)
  );
  if (haveAllBuildsFailedOrCanceled || !flags.autoSubmit) {
    exitWithNonZeroCodeIfSomeBuildsFailed(builds);
  } else {
    // the following function also exits with non zero code if any of the submissions failed
    await waitForSubmissionsToCompleteAsync(submissions);
  }
}

async function prepareAndStartBuildAsync({
  projectDir,
  flags,
  moreBuilds,
  buildProfile,
  resourceClass,
}: {
  projectDir: string;
  flags: BuildFlags;
  moreBuilds: boolean;
  buildProfile: ProfileData<'build'>;
  resourceClass: BuildResourceClass;
}): Promise<{ build: BuildFragment | undefined; buildCtx: BuildContext<Platform> }> {
  const buildCtx = await createBuildContextAsync({
    buildProfileName: buildProfile.profileName,
    resourceClass,
    clearCache: flags.clearCache,
    buildProfile: buildProfile.profile,
    nonInteractive: flags.nonInteractive,
    platform: buildProfile.platform,
    projectDir,
    localBuildOptions: flags.localBuildOptions,
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
