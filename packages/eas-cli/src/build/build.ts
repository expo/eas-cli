import { ArchiveSource, ArchiveSourceType, Job, Metadata, Platform } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import { withAnalyticsAsync } from '../analytics/common';
import { BuildEvent } from '../analytics/events';
import { getExpoWebsiteBaseUrl } from '../api';
import {
  AppPlatform,
  BuildFragment,
  BuildParamsInput,
  BuildPriority,
  BuildStatus,
  UploadSessionType,
} from '../graphql/generated';
import { BuildResult } from '../graphql/mutations/BuildMutation';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import Log, { learnMore } from '../log';
import { Ora, ora } from '../ora';
import {
  appPlatformDisplayNames,
  appPlatformEmojis,
  requestedPlatformDisplayNames,
} from '../platform';
import { uploadFileAtPathToS3Async } from '../uploads';
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
  sendBuildRequestAsync(
    appId: string,
    job: TJob,
    metadata: Metadata,
    buildParams: BuildParamsInput
  ): Promise<BuildResult>;
}

export type BuildRequestSender = () => Promise<BuildFragment | undefined>;

function resolveBuildParamsInput<T extends Platform>(ctx: BuildContext<T>): BuildParamsInput {
  return {
    resourceClass: ctx.resourceClass,
  };
}

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
  const buildParams = resolveBuildParamsInput(ctx);
  const job = await builder.prepareJobAsync(ctx, {
    projectArchive,
    credentials: credentialsResult?.credentials,
  });

  return async () => {
    if (ctx.localBuildOptions.enable) {
      await runLocalBuildAsync(job, metadata, ctx.localBuildOptions);
      return undefined;
    } else {
      try {
        return await sendBuildRequestAsync(builder, job, metadata, buildParams);
      } catch (error: any) {
        handleBuildRequestError(error, job.platform);
      }
    }
  };
}

function handleBuildRequestError(error: any, platform: Platform): never {
  if (error?.graphQLErrors?.[0]?.extensions?.errorCode === 'TURTLE_DEPRECATED_JOB_FORMAT') {
    Log.error('EAS Build API has changed. Upgrade to the latest eas-cli version.');
    throw new Error('Build request failed.');
  } else if (
    error?.graphQLErrors?.[0]?.extensions?.errorCode === 'EAS_BUILD_DOWN_FOR_MAINTENANCE'
  ) {
    Log.error(
      'EAS Build is down for maintenance. Try again later. Check https://status.expo.dev/ for updates.'
    );
    throw new Error('Build request failed.');
  } else if (error?.graphQLErrors?.[0]?.extensions?.errorCode === 'EAS_BUILD_FREE_TIER_DISABLED') {
    Log.error(
      'EAS Build free tier is temporarily disabled. Try again later. Check https://status.expo.dev/ for updates.'
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
      'Build request failed. Make sure you are using the latest eas-cli version. If the problem persists, report the issue.'
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
        Log.newLine();
        Log.log(
          `Compressing project files and uploading to EAS Build. ${learnMore(
            'https://expo.fyi/eas-build-archive'
          )}`
        );
        const projectTarball = await makeProjectTarballAsync();

        if (projectTarball.size > 1024 * 1024 * 100) {
          Log.warn(
            `Your project archive is ${formatBytes(
              projectTarball.size
            )}. You can reduce its size and the time it takes to upload by excluding files that are unnecessary for the build process in ${chalk.bold(
              '.easignore'
            )} file. ${learnMore('https://expo.fyi/eas-build-archive')}`
          );
        }

        projectTarballPath = projectTarball.path;

        const { bucketKey } = await uploadFileAtPathToS3Async(
          UploadSessionType.EasBuildProjectSources,
          projectTarball.path,
          createProgressTracker({
            total: projectTarball.size,
            message: ratio =>
              `Uploading to EAS Build (${formatBytes(projectTarball.size * ratio)} / ${formatBytes(
                projectTarball.size
              )})`,
            completedMessage: (duration: string) => `Uploaded to EAS ${chalk.dim(duration)}`,
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
  metadata: Metadata,
  buildParams: BuildParamsInput
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
        metadata,
        buildParams
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
  { intervalSec = 10 } = {}
): Promise<MaybeBuildFragment[]> {
  let spinner;
  let originalSpinnerText;
  if (buildIds.length === 1) {
    Log.log('Waiting for build to complete. You can press Ctrl+C to exit.');
    originalSpinnerText = 'Waiting for build to complete.';
    spinner = ora(originalSpinnerText).start();
  } else {
    originalSpinnerText = 'Waiting for builds to complete. You can press Ctrl+C to exit.';
    spinner = ora('Waiting for builds to complete. You can press Ctrl+C to exit.').start();
  }
  while (true) {
    const builds = await getBuildsSafelyAsync(buildIds);
    const { refetch } =
      builds.length === 1
        ? await handleSingleBuildProgressAsync({ build: builds[0], accountName }, { spinner })
        : await handleMultipleBuildsProgressAsync({ builds }, { spinner, originalSpinnerText });
    if (!refetch) {
      return builds;
    }
    await sleepAsync(intervalSec * 1000);
  }
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
        if (build.priority !== BuildPriority.High) {
          Log.newLine();
          Log.log('Start builds sooner in the priority queue.');
          Log.log(
            `Sign up for EAS Production or Enterprise at ${chalk.underline(
              formatAccountSubscriptionsUrl(accountName)
            )}`
          );
        }
        Log.newLine();
        Log.log(`Waiting in ${priorityToQueueDisplayName[build.priority]}`);
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

const priorityToQueueDisplayName: Record<BuildPriority, string> = {
  [BuildPriority.Normal]: 'queue',
  [BuildPriority.NormalPlus]: 'queue',
  [BuildPriority.High]: 'priority queue',
};

const statusToDisplayName: Record<BuildStatus, string> = {
  [BuildStatus.New]: 'waiting to enter the queue (concurrency limit reached)',
  [BuildStatus.InQueue]: 'in queue',
  [BuildStatus.InProgress]: 'in progress',
  [BuildStatus.Canceled]: 'canceled',
  [BuildStatus.Finished]: 'finished',
  [BuildStatus.Errored]: 'failed',
};

const platforms = [AppPlatform.Android, AppPlatform.Ios];

async function handleMultipleBuildsProgressAsync(
  { builds: maybeBuilds }: { builds: MaybeBuildFragment[] },
  { spinner, originalSpinnerText }: { spinner: Ora; originalSpinnerText: string }
): Promise<BuildProgressResult> {
  const buildCount = maybeBuilds.length;
  const builds = maybeBuilds.filter<BuildFragment>(isBuildFragment);

  const allFinished =
    builds.filter(build => build.status === BuildStatus.Finished).length === buildCount;
  const allSettled =
    builds.filter(build =>
      [BuildStatus.Finished, BuildStatus.Errored, BuildStatus.Canceled].includes(build.status)
    ).length === buildCount;

  if (allSettled) {
    if (allFinished) {
      spinner.succeed(formatSettledBuildsText(builds));
    } else {
      spinner.fail(formatSettledBuildsText(builds));
    }
    return { refetch: false };
  } else {
    spinner.text = formatPendingBuildsText(originalSpinnerText, builds);
    return { refetch: true };
  }
}

function formatSettledBuildsText(builds: BuildFragment[]): string {
  return platforms
    .map(platform => {
      const build = nullthrows(
        builds.find(build => build.platform === platform),
        `Build for platform ${platform} must be defined in this context`
      );
      return `${appPlatformEmojis[platform]} ${
        appPlatformDisplayNames[platform]
      } build - status: ${chalk.bold(statusToDisplayName[build.status])}`;
    })
    .join('\n  ');
}

function formatPendingBuildsText(originalSpinnerText: string, builds: BuildFragment[]): string {
  return [
    originalSpinnerText,
    ...platforms.map(platform => {
      const build = builds.find(build => build.platform === platform);
      const status = build ? statusToDisplayName[build.status] : 'unknown';
      let extraInfo = '';
      if (
        build?.status === BuildStatus.InQueue &&
        typeof build.initialQueuePosition === 'number' &&
        typeof build.queuePosition === 'number'
      ) {
        const percent = Math.floor(
          ((build.initialQueuePosition - build.queuePosition + 1) /
            (build.initialQueuePosition + 1)) *
            100
        );
        const estimatedWaitTime =
          typeof build.estimatedWaitTimeLeftSeconds === 'number'
            ? ` - ${formatEstimatedWaitTime(build.estimatedWaitTimeLeftSeconds)}`
            : '';
        extraInfo = ` - queue progress: ${chalk.bold(`${percent}%`)}${estimatedWaitTime}`;
      }
      return `${appPlatformEmojis[platform]} ${
        appPlatformDisplayNames[platform]
      } build - status: ${chalk.bold(status)}${extraInfo}`;
    }),
  ].join('\n  ');
}

function isBuildFragment(maybeBuild: MaybeBuildFragment): maybeBuild is BuildFragment {
  return maybeBuild !== null;
}

function formatEstimatedWaitTime(estimatedWaitTimeLeftSeconds: number): string {
  if (estimatedWaitTimeLeftSeconds < 5 * 60) {
    return 'starting soon...';
  } else {
    const n = Math.floor(estimatedWaitTimeLeftSeconds / (10 * 60)) + 1;
    return `starting in about ${n}0 minutes...`;
  }
}

function formatAccountSubscriptionsUrl(accountName: string): string {
  return new URL(
    `/accounts/${accountName}/settings/subscriptions`,
    getExpoWebsiteBaseUrl()
  ).toString();
}
