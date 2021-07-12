import { ArchiveSource, ArchiveSourceType, Job, Metadata } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import fs from 'fs-extra';

import { UploadSessionType } from '../graphql/generated';
import { BuildResult } from '../graphql/mutations/BuildMutation';
import Log from '../log';
import { promptAsync } from '../prompts';
import { uploadAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';
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

export async function prepareBuildRequestForPlatformAsync<
  TPlatform extends Platform,
  Credentials,
  TJob extends Job
>(builder: Builder<TPlatform, Credentials, TJob>): Promise<() => Promise<string | undefined>> {
  const credentialsResult = await withAnalyticsAsync(
    async () => await builder.ensureCredentialsAsync(builder.ctx),
    {
      successEvent: Event.GATHER_CREDENTIALS_SUCCESS,
      failureEvent: Event.GATHER_CREDENTIALS_FAIL,
      trackingCtx: builder.ctx.trackingCtx,
    }
  );
  if (!builder.ctx.commandCtx.skipProjectConfiguration) {
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
        nonInteractive: builder.ctx.commandCtx.nonInteractive,
      }
    );
  }

  const projectArchive = builder.ctx.commandCtx.local
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
    if (builder.ctx.commandCtx.local) {
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
            'EAS Build for free tier is temporarily disabled, please try again later. Check https://status.expo.dev/ for updates.'
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
): Promise<string> {
  const { ctx } = builder;
  return await withAnalyticsAsync(
    async () => {
      if (Log.isDebug) {
        Log.log(`Starting ${requestedPlatformDisplayNames[job.platform]} build`);
      }

      const { build, deprecationInfo } = await builder.sendBuildRequestAsync(
        ctx.commandCtx.projectId,
        job,
        metadata
      );

      printDeprecationWarnings(deprecationInfo);
      return build.id;
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
