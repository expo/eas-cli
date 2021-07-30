import { ArchiveSource, ArchiveSourceType, Job, Metadata } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';
import ora from 'ora';

import { BuildFragment, BuildStatus, UploadSessionType } from '../graphql/generated';
import { BuildResult } from '../graphql/mutations/BuildMutation';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import Log from '../log';
import { promptAsync } from '../prompts';
import { uploadAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';
import { sleep } from '../utils/promise';
import vcs from '../vcs';
import { requestedPlatformDisplayNames } from './constants';
import { BuildContext } from './context';
import { runLocalBuildAsync } from './local';
import { collectMetadata } from './metadata';
import { Platform, TrackingContext } from './types';
import Analytics, { Event } from './utils/analytics';
import { printDeprecationWarnings } from './utils/printBuildInfo';
import { commitPromptAsync, makeProjectTarballAsync } from './utils/repository';

export interface CredentialsResult<Credentials> {
  source: CredentialsSource.LOCAL | CredentialsSource.REMOTE;
  credentials: Credentials;
}

export interface JobData<Credentials> {
  credentials?: Credentials;
  projectArchive: ArchiveSource;
}

interface Builder<TPlatform extends Platform, Credentials, TJob extends Job> {
  ctx: BuildContext<TPlatform>;

  ensureCredentialsAsync(
    ctx: BuildContext<TPlatform>
  ): Promise<CredentialsResult<Credentials> | undefined>;
  ensureProjectConfiguredAsync(ctx: BuildContext<TPlatform>): Promise<void>;
  prepareJobAsync(ctx: BuildContext<TPlatform>, jobData: JobData<Credentials>): Promise<Job>;
  sendBuildRequestAsync(appId: string, job: TJob, metadata: Metadata): Promise<BuildResult>;
}

export type BuildRequestSender = () => Promise<BuildFragment | undefined>;

export async function prepareBuildRequestForPlatformAsync<
  TPlatform extends Platform,
  Credentials,
  TJob extends Job
>(builder: Builder<TPlatform, Credentials, TJob>): Promise<BuildRequestSender> {
  const credentialsResult = await withAnalyticsAsync(
    async () => await builder.ensureCredentialsAsync(builder.ctx),
    {
      successEvent: Event.GATHER_CREDENTIALS_SUCCESS,
      failureEvent: Event.GATHER_CREDENTIALS_FAIL,
      trackingCtx: builder.ctx.trackingCtx,
    }
  );
  if (!builder.ctx.skipProjectConfiguration) {
    await withAnalyticsAsync(async () => await builder.ensureProjectConfiguredAsync(builder.ctx), {
      successEvent: Event.CONFIGURE_PROJECT_SUCCESS,
      failureEvent: Event.CONFIGURE_PROJECT_FAIL,
      trackingCtx: builder.ctx.trackingCtx,
    });
  }

  if (await vcs.hasUncommittedChangesAsync()) {
    Log.addNewLineIfNone();
    await reviewAndCommitChangesAsync(
      `[EAS Build] Run EAS Build for ${
        requestedPlatformDisplayNames[builder.ctx.platform as Platform]
      }`,
      {
        nonInteractive: builder.ctx.nonInteractive,
      }
    );
  }

  const projectArchive = builder.ctx.local
    ? ({
        type: ArchiveSourceType.PATH,
        path: (await makeProjectTarballAsync()).path,
      } as const)
    : ({
        type: ArchiveSourceType.S3,
        bucketKey: await uploadProjectAsync(builder.ctx),
      } as const);

  const metadata = await collectMetadata(builder.ctx, {
    credentialsSource: credentialsResult?.source,
  });
  const job = await builder.prepareJobAsync(builder.ctx, {
    projectArchive,
    credentials: credentialsResult?.credentials,
  });

  return async () => {
    if (builder.ctx.local) {
      await runLocalBuildAsync(job);
      return undefined;
    } else {
      try {
        return await sendBuildRequestAsync(builder, job, metadata);
      } catch (error) {
        if (error?.graphQLErrors?.[0]?.extensions?.errorCode === 'TURTLE_DEPRECATED_JOB_FORMAT') {
          Log.error('EAS Build API has changed, please upgrade to the latest eas-cli version.');
          throw new Error('Build request failed.');
        } else if (
          error?.graphQLErrors?.[0]?.extensions?.errorCode === 'EAS_BUILD_DOWN_FOR_MAINTENANCE'
        ) {
          Log.error(
            'EAS Build is down for maintenance, please try again later. Check https://status.expo.dev/ for updates.'
          );
          throw new Error('Build request failed.');
        } else if (
          error?.graphQLErrors?.[0]?.extensions?.errorCode === 'EAS_BUILD_FREE_TIER_DISABLED'
        ) {
          Log.error(
            'EAS Build free tier is temporarily disabled, please try again later. Check https://status.expo.dev/ for updates.'
          );
          throw new Error('Build request failed.');
        } else if (
          error?.graphQLErrors?.[0]?.extensions?.errorCode === 'EAS_BUILD_TOO_MANY_PENDING_BUILDS'
        ) {
          Log.error(
            `You have already reached the maximum number of pending ${
              requestedPlatformDisplayNames[job.platform]
            } builds for your account. Try again later.`
          );
          throw new Error('Build request failed.');
        } else if (error?.graphQLErrors) {
          Log.error(
            'Build request failed. Make sure you are using the latest eas-cli version. If the problem persists, please report the issue.'
          );
        }
        throw error;
      }
    }
  };
}

async function uploadProjectAsync<TPlatform extends Platform>(
  ctx: BuildContext<TPlatform>
): Promise<string> {
  let projectTarballPath;
  try {
    return await withAnalyticsAsync(
      async () => {
        const projectTarball = await makeProjectTarballAsync();
        projectTarballPath = projectTarball.path;

        const { bucketKey } = await uploadAsync(
          UploadSessionType.EasBuildProjectSources,
          projectTarball.path,
          createProgressTracker({
            total: projectTarball.size,
            message: ratio =>
              `Uploading to EAS Build (${formatBytes(projectTarball.size * ratio)} / ${formatBytes(
                projectTarball.size
              )})`,
            completedMessage: `Uploaded to EAS`,
          })
        );
        return bucketKey;
      },
      {
        successEvent: Event.PROJECT_UPLOAD_SUCCESS,
        failureEvent: Event.PROJECT_UPLOAD_FAIL,
        trackingCtx: ctx.trackingCtx,
      }
    );
  } finally {
    if (projectTarballPath) {
      await fs.remove(projectTarballPath);
    }
  }
}

async function sendBuildRequestAsync<TPlatform extends Platform, Credentials, TJob extends Job>(
  builder: Builder<TPlatform, Credentials, TJob>,
  job: TJob,
  metadata: Metadata
): Promise<BuildFragment> {
  const { ctx } = builder;
  return await withAnalyticsAsync(
    async () => {
      if (Log.isDebug) {
        Log.log(`Starting ${requestedPlatformDisplayNames[job.platform]} build`);
      }

      const { build, deprecationInfo } = await builder.sendBuildRequestAsync(
        ctx.projectId,
        job,
        metadata
      );

      printDeprecationWarnings(deprecationInfo);
      return build;
    },
    {
      successEvent: Event.BUILD_REQUEST_SUCCESS,
      failureEvent: Event.BUILD_REQUEST_FAIL,
      trackingCtx: ctx.trackingCtx,
    }
  );
}

async function withAnalyticsAsync<Result>(
  fn: () => Promise<Result>,
  analytics: {
    successEvent: Event;
    failureEvent: Event;
    trackingCtx: TrackingContext;
  }
): Promise<Result> {
  try {
    const result = await fn();
    Analytics.logEvent(analytics.successEvent, analytics.trackingCtx);
    return result;
  } catch (error) {
    Analytics.logEvent(analytics.failureEvent, {
      ...analytics.trackingCtx,
      reason: error.message,
    });
    throw error;
  }
}

enum ShouldCommitChanges {
  Yes,
  ShowDiffFirst,
  Abort,
}

async function reviewAndCommitChangesAsync(
  initialCommitMessage: string,
  { nonInteractive, askedFirstTime = true }: { nonInteractive: boolean; askedFirstTime?: boolean }
): Promise<void> {
  if (process.env.EAS_BUILD_AUTOCOMMIT) {
    await vcs.commitAsync({ commitMessage: initialCommitMessage, commitAllFiles: false });
    Log.withTick('Committed changes.');
    return;
  }
  if (nonInteractive) {
    throw new Error(
      'Cannot commit changes when --non-interactive is specified. Run the command in interactive mode or set EAS_BUILD_AUTOCOMMIT=1 in your environment.'
    );
  }
  const { selected } = await promptAsync({
    type: 'select',
    name: 'selected',
    message: 'Can we commit these changes to git for you?',
    choices: [
      { title: 'Yes', value: ShouldCommitChanges.Yes },
      ...(askedFirstTime
        ? [{ title: 'Show the diff and ask me again', value: ShouldCommitChanges.ShowDiffFirst }]
        : []),
      {
        title: 'Abort build process',
        value: ShouldCommitChanges.Abort,
      },
    ],
  });

  if (selected === ShouldCommitChanges.Abort) {
    throw new Error(
      "Aborting, run the command again once you're ready. Make sure to commit any changes you've made."
    );
  } else if (selected === ShouldCommitChanges.Yes) {
    await commitPromptAsync({ initialCommitMessage });
    Log.withTick('Committed changes.');
  } else if (selected === ShouldCommitChanges.ShowDiffFirst) {
    await vcs.showDiffAsync();
    await reviewAndCommitChangesAsync(initialCommitMessage, {
      nonInteractive,
      askedFirstTime: false,
    });
  }
}

export async function waitForBuildEndAsync(
  buildIds: string[],
  { timeoutSec = 3600, intervalSec = 30 } = {}
): Promise<(BuildFragment | null)[]> {
  Log.log(
    `Waiting for build${buildIds.length > 1 ? 's' : ''} to complete. You can press Ctrl+C to exit.`
  );
  const spinner = ora().start();
  let time = new Date().getTime();
  const endTime = time + timeoutSec * 1000;
  while (time <= endTime) {
    const builds: (BuildFragment | null)[] = await Promise.all(
      buildIds.map(async buildId => {
        try {
          return await BuildQuery.byIdAsync(buildId, { useCache: false });
        } catch (err) {
          return null;
        }
      })
    );
    if (builds.length === 1) {
      const build = nullthrows(builds[0]);
      switch (build.status) {
        case BuildStatus.Finished:
          spinner.succeed('Build finished');
          return builds;
        case BuildStatus.New:
          spinner.text = 'Build created';
          break;
        case BuildStatus.InQueue:
          spinner.text = 'Build queued...';
          break;
        case BuildStatus.Canceled:
          spinner.text = 'Build canceled';
          spinner.stopAndPersist();
          return builds;
        case BuildStatus.InProgress:
          spinner.text = 'Build in progress...';
          break;
        case BuildStatus.Errored:
          spinner.fail('Build failed');
          if (build.error) {
            return builds;
          } else {
            throw new Error(`Standalone build failed!`);
          }
        default:
          spinner.warn('Unknown status.');
          throw new Error(`Unknown status: ${builds} - aborting!`);
      }
    } else {
      if (builds.filter(build => build?.status === BuildStatus.Finished).length === builds.length) {
        spinner.succeed('All builds have finished');
        return builds;
      } else if (
        builds.filter(build =>
          build?.status
            ? [BuildStatus.Finished, BuildStatus.Errored, BuildStatus.Canceled].includes(
                build.status
              )
            : false
        ).length === builds.length
      ) {
        spinner.fail('Some of the builds were canceled or failed.');
        return builds;
      } else {
        const newBuilds = builds.filter(build => build?.status === BuildStatus.New).length;
        const inQueue = builds.filter(build => build?.status === BuildStatus.InQueue).length;
        const inProgress = builds.filter(build => build?.status === BuildStatus.InProgress).length;
        const errored = builds.filter(build => build?.status === BuildStatus.Errored).length;
        const finished = builds.filter(build => build?.status === BuildStatus.Finished).length;
        const canceled = builds.filter(build => build?.status === BuildStatus.Canceled).length;
        const unknownState = builds.length - newBuilds - inQueue - inProgress - errored - finished;
        spinner.text = [
          newBuilds && `Builds created: ${newBuilds}`,
          inQueue && `Builds in queue: ${inQueue}`,
          inProgress && `Builds in progress: ${inProgress}`,
          canceled && `Builds canceled: ${canceled}`,
          errored && chalk.red(`Builds failed: ${errored}`),
          finished && chalk.green(`Builds finished: ${finished}`),
          unknownState && chalk.red(`Builds in unknown state: ${unknownState}`),
        ]
          .filter(i => i)
          .join('\t');
      }
    }
    time = new Date().getTime();
    await sleep(intervalSec * 1000);
  }
  spinner.warn('Timed out');
  throw new Error(
    'Timeout reached! It is taking longer than expected to finish the build, aborting...'
  );
}
