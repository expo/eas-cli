import { ArchiveSource, ArchiveSourceType, Job, Metadata, Platform } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import { BuildFragment, BuildStatus, UploadSessionType } from '../graphql/generated';
import { BuildResult } from '../graphql/mutations/BuildMutation';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import Log, { learnMore } from '../log';
import { ora } from '../ora';
import { requestedPlatformDisplayNames } from '../platform';
import { uploadAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';
import { sleepAsync } from '../utils/promise';
import vcs from '../vcs';
import { BuildContext } from './context';
import { runLocalBuildAsync } from './local';
import { MetadataContext, collectMetadataAsync } from './metadata';
import { TrackingContext } from './types';
import Analytics, { Event } from './utils/analytics';
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
  ensureProjectConfiguredAsync(ctx: BuildContext<TPlatform>): Promise<void>;
  getMetadataContext: () => MetadataContext<TPlatform>;
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
      successEvent: Event.GATHER_CREDENTIALS_SUCCESS,
      failureEvent: Event.GATHER_CREDENTIALS_FAIL,
      trackingCtx: ctx.trackingCtx,
    }
  );
  if (!ctx.skipProjectConfiguration) {
    await withAnalyticsAsync(async () => await builder.ensureProjectConfiguredAsync(ctx), {
      successEvent: Event.CONFIGURE_PROJECT_SUCCESS,
      failureEvent: Event.CONFIGURE_PROJECT_FAIL,
      trackingCtx: ctx.trackingCtx,
    });
  }

  if (await vcs.hasUncommittedChangesAsync()) {
    Log.addNewLineIfNone();
    await reviewAndCommitChangesAsync(
      `[EAS Build] Run EAS Build for ${requestedPlatformDisplayNames[ctx.platform as Platform]}`,
      { nonInteractive: ctx.nonInteractive }
    );
  }

  const projectArchive = ctx.local
    ? ({
        type: ArchiveSourceType.PATH,
        path: (await makeProjectTarballAsync()).path,
      } as const)
    : ({
        type: ArchiveSourceType.S3,
        bucketKey: await uploadProjectAsync(ctx),
      } as const);

  const metadataContext = builder.getMetadataContext();
  const metadata = await collectMetadataAsync(ctx, metadataContext);
  const job = await builder.prepareJobAsync(ctx, {
    projectArchive,
    credentials: credentialsResult?.credentials,
  });

  return async () => {
    if (ctx.local) {
      await runLocalBuildAsync(job);
      return undefined;
    } else {
      try {
        return await sendBuildRequestAsync(builder, job, metadata);
      } catch (error: any) {
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
            completedMessage: (duration: string) =>
              `Uploaded to EAS ${chalk.dim(duration)} ${learnMore(
                'https://expo.fyi/eas-build-archive'
              )}`,
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
  } catch (error: any) {
    Analytics.logEvent(analytics.failureEvent, {
      ...analytics.trackingCtx,
      reason: error.message,
    });
    throw error;
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
    await sleepAsync(intervalSec * 1000);
  }
  spinner.warn('Timed out');
  throw new Error(
    'Timeout reached! It is taking longer than expected to finish the build, aborting...'
  );
}
