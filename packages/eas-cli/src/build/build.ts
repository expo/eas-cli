import { ArchiveSource, ArchiveSourceType, Job, Metadata, Platform } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import fs from 'fs-extra';

import { withAnalyticsAsync } from '../analytics/common';
import { BuildEvent } from '../analytics/events';
import { getExpoWebsiteBaseUrl } from '../api';
import { BuildFragment, BuildStatus, UploadSessionType } from '../graphql/generated';
import { BuildResult } from '../graphql/mutations/BuildMutation';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import Log, { learnMore } from '../log';
import { Ora, ora } from '../ora';
import { requestedPlatformDisplayNames } from '../platform';
import { uploadAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';
import { sleepAsync } from '../utils/promise';
import { getVcsClient } from '../vcs';
import { BuildContext } from './context';
import { runLocalBuildAsync } from './local';
import { collectMetadataAsync } from './metadata';
import { printDeprecationWarnings } from './utils/printBuildInfo';
import { makeProjectTarballAsync, reviewAndCommitChangesAsync } from './utils/repository';

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
  syncProjectConfigurationAsync(ctx: BuildContext<TPlatform>): Promise<void>;
  prepareJobAsync(ctx: BuildContext<TPlatform>, jobData: JobData<Credentials>): Promise<Job>;
  sendBuildRequestAsync(appId: string, job: TJob, metadata: Metadata): Promise<BuildResult>;
}

export type BuildRequestSender = () => Promise<BuildFragment | undefined>;

export async function prepareBuildRequestForPlatformAsync<
  TPlatform extends Platform,
  Credentials,
  TJob extends Job
>(builder: Builder<TPlatform, Credentials, TJob>): Promise<BuildRequestSender> {
  const { ctx } = builder;
  const credentialsResult = await withAnalyticsAsync(
    async () => await builder.ensureCredentialsAsync(ctx),
    {
      attemptEvent: BuildEvent.GATHER_CREDENTIALS_ATTEMPT,
      successEvent: BuildEvent.GATHER_CREDENTIALS_SUCCESS,
      failureEvent: BuildEvent.GATHER_CREDENTIALS_FAIL,
      trackingCtx: ctx.trackingCtx,
    }
  );

  await withAnalyticsAsync(async () => await builder.syncProjectConfigurationAsync(ctx), {
    attemptEvent: BuildEvent.CONFIGURE_PROJECT_ATTEMPT,
    successEvent: BuildEvent.CONFIGURE_PROJECT_SUCCESS,
    failureEvent: BuildEvent.CONFIGURE_PROJECT_FAIL,
    trackingCtx: ctx.trackingCtx,
  });

  if (await getVcsClient().isCommitRequiredAsync()) {
    Log.addNewLineIfNone();
    await reviewAndCommitChangesAsync(
      `[EAS Build] Run EAS Build for ${requestedPlatformDisplayNames[ctx.platform as Platform]}`,
      { nonInteractive: ctx.nonInteractive }
    );
  }

  const projectArchive = ctx.localBuildOptions.enable
    ? ({
        type: ArchiveSourceType.PATH,
        path: (await makeProjectTarballAsync()).path,
      } as const)
    : ({
        type: ArchiveSourceType.S3,
        bucketKey: await uploadProjectAsync(ctx),
      } as const);

  const metadata = await collectMetadataAsync(ctx);
  const job = await builder.prepareJobAsync(ctx, {
    projectArchive,
    credentials: credentialsResult?.credentials,
  });

  return async () => {
    if (ctx.localBuildOptions.enable) {
      await runLocalBuildAsync(job, ctx.localBuildOptions);
      return undefined;
    } else {
      try {
        return await sendBuildRequestAsync(builder, job, metadata);
      } catch (error: any) {
        handleBuildRequestError(error, job.platform);
      }
    }
  };
}

function handleBuildRequestError(error: any, platform: Platform): never {
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
  } else if (error?.graphQLErrors?.[0]?.extensions?.errorCode === 'EAS_BUILD_FREE_TIER_DISABLED') {
    Log.error(
      'EAS Build free tier is temporarily disabled, please try again later. Check https://status.expo.dev/ for updates.'
    );
    throw new Error('Build request failed.');
  } else if (
    error?.graphQLErrors?.[0]?.extensions?.errorCode === 'EAS_BUILD_TOO_MANY_PENDING_BUILDS'
  ) {
    Log.error(
      `You have already reached the maximum number of pending ${requestedPlatformDisplayNames[platform]} builds for your account. Try again later.`
    );
    throw new Error('Build request failed.');
  } else if (error?.graphQLErrors) {
    Log.error(
      'Build request failed. Make sure you are using the latest eas-cli version. If the problem persists, please report the issue.'
    );
  }
  throw error;
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
            completedMessage: (duration: string) =>
              `Uploaded to EAS ${chalk.dim(duration)} ${learnMore(
                'https://expo.fyi/eas-build-archive'
              )}`,
          })
        );
        return bucketKey;
      },
      {
        attemptEvent: BuildEvent.PROJECT_UPLOAD_ATTEMPT,
        successEvent: BuildEvent.PROJECT_UPLOAD_SUCCESS,
        failureEvent: BuildEvent.PROJECT_UPLOAD_FAIL,
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
      attemptEvent: BuildEvent.BUILD_REQUEST_ATTEMPT,
      successEvent: BuildEvent.BUILD_REQUEST_SUCCESS,
      failureEvent: BuildEvent.BUILD_REQUEST_FAIL,
      trackingCtx: ctx.trackingCtx,
    }
  );
}

type MaybeBuildFragment = BuildFragment | null;

export async function waitForBuildEndAsync(
  { buildIds, accountName }: { buildIds: string[]; accountName: string },
  {
    // 2 hours (max build time limit) + 10 minutes (possible queue time )
    timeoutSec = 2 * 60 * 60 + 10 * 60,
    intervalSec = 10,
  } = {}
): Promise<MaybeBuildFragment[]> {
  const b = `build${buildIds.length > 1 ? 's' : ''}`;
  Log.log(`Waiting for ${b} to complete. You can press Ctrl+C to exit.`);
  const spinner = ora(`Waiting for ${b} to complete.`).start();
  const endTime = new Date().getTime() + timeoutSec * 1000;
  while (new Date().getTime() <= endTime) {
    const builds = await getBuildsSafelyAsync(buildIds);
    const { refetch } =
      builds.length === 1
        ? await handleSingleBuildProgressAsync({ build: builds[0], accountName }, { spinner })
        : await handleMultipleBuildsProgressAsync({ builds }, { spinner });
    if (!refetch) {
      return builds;
    }
    await sleepAsync(intervalSec * 1000);
  }
  spinner.fail('Timed out');
  throw new Error(
    'Timeout reached! It is taking longer than expected to finish the build, aborting...'
  );
}

async function getBuildsSafelyAsync(buildIds: string[]): Promise<MaybeBuildFragment[]> {
  const promises = buildIds.map(async buildId => {
    try {
      return await BuildQuery.byIdAsync(buildId, { useCache: false });
    } catch (err) {
      Log.debug('Failed to fetch the build status', err);
      return null;
    }
  });
  return await Promise.all(promises);
}

interface BuildProgressResult {
  refetch: boolean;
}

let queueProgressBarStarted = false;
const queueProgressBar = new cliProgress.SingleBar(
  { format: '|{bar}| {estimatedWaitTime}' },
  cliProgress.Presets.rect
);

async function handleSingleBuildProgressAsync(
  { build, accountName }: { build: MaybeBuildFragment; accountName: string },
  { spinner }: { spinner: Ora }
): Promise<BuildProgressResult> {
  if (build === null) {
    spinner.text = 'Could not fetch the build status. Check your network connection.';
    return { refetch: true };
  }

  if (queueProgressBarStarted && build?.status && build.status !== BuildStatus.InQueue) {
    if (build.status === BuildStatus.InProgress) {
      queueProgressBar.update(queueProgressBar.getTotal(), {
        estimatedWaitTime: '',
      });
    }
    queueProgressBar.stop();
    Log.newLine();
    queueProgressBarStarted = false;
    spinner.start('Build is about to start');
  }

  switch (build.status) {
    case BuildStatus.Finished:
      spinner.succeed('Build finished');
      return { refetch: false };
    case BuildStatus.New:
      spinner.text = `Build is waiting to enter the queue. Check your concurrency limit at ${chalk.underline(
        formatAccountSubscriptionsUrl(accountName)
      )}.`;
      break;
    case BuildStatus.InQueue: {
      spinner.text = 'Build queued...';
      const progressBarPayload =
        typeof build.estimatedWaitTimeLeftSeconds === 'number'
          ? { estimatedWaitTime: formatEstimatedWaitTime(build.estimatedWaitTimeLeftSeconds) }
          : { estimatedWaitTime: '' };

      if (
        !queueProgressBarStarted &&
        typeof build.initialQueuePosition === 'number' &&
        typeof build.queuePosition === 'number'
      ) {
        spinner.stopAndPersist();
        Log.newLine();
        Log.log('Waiting in queue');
        queueProgressBar.start(
          build.initialQueuePosition + 1,
          build.initialQueuePosition - build.queuePosition + 1,
          progressBarPayload
        );
        queueProgressBarStarted = true;
      }
      if (typeof build.queuePosition === 'number') {
        queueProgressBar.update(build.queuePosition, progressBarPayload);
      }
      break;
    }
    case BuildStatus.Canceled:
      spinner.fail('Build canceled');
      return { refetch: false };
    case BuildStatus.InProgress:
      spinner.text = 'Build in progress...';
      break;
    case BuildStatus.Errored:
      spinner.fail('Build failed');
      if (build.error) {
        return { refetch: false };
      } else {
        throw new Error('Standalone build failed!');
      }
    default:
      spinner.warn('Unknown status');
      throw new Error(`Unknown build status: ${build.status} - aborting!`);
  }
  return { refetch: true };
}

async function handleMultipleBuildsProgressAsync(
  { builds: maybeBuilds }: { builds: MaybeBuildFragment[] },
  { spinner }: { spinner: Ora }
): Promise<BuildProgressResult> {
  const buildCount = maybeBuilds.length;
  const builds = maybeBuilds.filter<BuildFragment>(isBuildFragment);

  const allFinished =
    builds.filter(build => build.status === BuildStatus.Finished).length === buildCount;
  const allSettled =
    builds.filter(build =>
      [BuildStatus.Finished, BuildStatus.Errored, BuildStatus.Canceled].includes(build.status)
    ).length === buildCount;

  if (allFinished) {
    spinner.succeed('All builds have finished');
    return { refetch: false };
  } else if (allSettled) {
    spinner.fail('Some of the builds were canceled or failed.');
    return { refetch: false };
  } else {
    const newBuilds = builds.filter(build => build.status === BuildStatus.New).length;
    const inQueue = builds.filter(build => build.status === BuildStatus.InQueue).length;
    const inProgress = builds.filter(build => build.status === BuildStatus.InProgress).length;
    const errored = builds.filter(build => build.status === BuildStatus.Errored).length;
    const finished = builds.filter(build => build.status === BuildStatus.Finished).length;
    const canceled = builds.filter(build => build.status === BuildStatus.Canceled).length;
    const unknown = buildCount - newBuilds - inQueue - inProgress - errored - finished - canceled;
    const text = [
      newBuilds && `Builds created: ${newBuilds}`,
      inQueue && `Builds in queue: ${inQueue}`,
      inProgress && `Builds in progress: ${inProgress}`,
      canceled && `Builds canceled: ${canceled}`,
      errored && chalk.red(`Builds failed: ${errored}`),
      finished && chalk.green(`Builds finished: ${finished}`),
      unknown && chalk.red(`Builds in unknown state: ${unknown}`),
    ]
      .filter(i => i)
      .join('\t');
    spinner.text = text;
    return { refetch: true };
  }
}

function isBuildFragment(maybeBuild: MaybeBuildFragment): maybeBuild is BuildFragment {
  return maybeBuild !== null;
}

function formatEstimatedWaitTime(estimatedWaitTimeLeftSeconds: number): string {
  if (estimatedWaitTimeLeftSeconds < 5 * 60) {
    return 'Starting soon...';
  } else {
    const n = Math.floor(estimatedWaitTimeLeftSeconds / (10 * 60)) + 1;
    return `Starting in about ${n}0 minutes...`;
  }
}

function formatAccountSubscriptionsUrl(accountName: string): string {
  return new URL(
    `/accounts/${accountName}/settings/subscriptions`,
    getExpoWebsiteBaseUrl()
  ).toString();
}
