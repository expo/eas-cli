import { Job, Metadata } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import fs from 'fs-extra';

import { BuildResult } from '../graphql/mutations/BuildMutation';
import Log from '../log';
import { promptAsync } from '../prompts';
import { UploadType, uploadAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';
import { requestedPlatformDisplayNames } from './constants';
import { BuildContext } from './context';
import { collectMetadata } from './metadata';
import { Platform, TrackingContext } from './types';
import Analytics, { Event } from './utils/analytics';
import { printDeprecationWarnings } from './utils/printBuildInfo';
import {
  commitChangedFilesAsync,
  commitPromptAsync,
  isGitStatusCleanAsync,
  makeProjectTarballAsync,
  showDiffAsync,
} from './utils/repository';

export interface CredentialsResult<Credentials> {
  source: CredentialsSource.LOCAL | CredentialsSource.REMOTE;
  credentials: Credentials;
}

interface Builder<TPlatform extends Platform, Credentials, ProjectConfiguration, TJob extends Job> {
  ctx: BuildContext<TPlatform>;
  projectConfiguration: ProjectConfiguration;

  ensureCredentialsAsync(
    ctx: BuildContext<TPlatform>
  ): Promise<CredentialsResult<Credentials> | undefined>;
  ensureProjectConfiguredAsync(ctx: BuildContext<TPlatform>): Promise<void>;
  prepareJobAsync(
    ctx: BuildContext<TPlatform>,
    jobData: {
      archiveBucketKey: string;
      credentials?: Credentials;
      projectConfiguration?: ProjectConfiguration;
    }
  ): Promise<Job>;
  sendBuildRequestAsync(appId: string, job: TJob, metadata: Metadata): Promise<BuildResult>;
}

export async function prepareBuildRequestForPlatformAsync<
  TPlatform extends Platform,
  Credentials,
  ProjectConfiguration,
  TJob extends Job
>(
  builder: Builder<TPlatform, Credentials, ProjectConfiguration, TJob>
): Promise<() => Promise<string>> {
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

  if (!(await isGitStatusCleanAsync())) {
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

  const archiveBucketKey = await uploadProjectAsync(builder.ctx);

  const metadata = await collectMetadata(builder.ctx, {
    credentialsSource: credentialsResult?.source,
  });
  const job = await builder.prepareJobAsync(builder.ctx, {
    archiveBucketKey,
    credentials: credentialsResult?.credentials,
    projectConfiguration: builder.projectConfiguration,
  });

  return async () => {
    try {
      return sendBuildRequestAsync(builder, job, metadata);
    } catch (error) {
      if (error?.expoApiV2ErrorCode === 'TURTLE_DEPRECATED_JOB_FORMAT') {
        Log.error('EAS Build API has changed, please upgrade to the latest eas-cli');
      }
      throw error;
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
          UploadType.TURTLE_PROJECT_SOURCES,
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

async function sendBuildRequestAsync<
  TPlatform extends Platform,
  Credentials,
  ProjectConfiguration,
  TJob extends Job
>(
  builder: Builder<TPlatform, Credentials, ProjectConfiguration, TJob>,
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
    await commitChangedFilesAsync(initialCommitMessage);
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
    await showDiffAsync();
    await reviewAndCommitChangesAsync(initialCommitMessage, {
      nonInteractive,
      askedFirstTime: false,
    });
  }
}
