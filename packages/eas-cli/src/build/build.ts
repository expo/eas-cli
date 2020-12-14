import { Job } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import fs from 'fs-extra';

import { apiClient } from '../api';
import log from '../log';
import { promptAsync } from '../prompts';
import { UploadType, uploadAsync } from '../uploads';
import { createProgressTracker } from '../utils/progress';
import { platformDisplayNames } from './constants';
import { BuildContext } from './context';
import { collectMetadata } from './metadata';
import { AnalyticsEvent, Platform, TrackingContext } from './types';
import Analytics from './utils/analytics';
import { printDeprecationWarnings } from './utils/printBuildInfo';
import {
  commitPromptAsync,
  isGitStatusCleanAsync,
  makeProjectTarballAsync,
  showDiffAsync,
} from './utils/repository';

export interface CredentialsResult<Credentials> {
  source: CredentialsSource.LOCAL | CredentialsSource.REMOTE;
  credentials: Credentials;
}

interface Builder<TPlatform extends Platform, Credentials, ProjectConfiguration> {
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
}

export async function prepareBuildRequestForPlatformAsync<
  TPlatform extends Platform,
  Credentials,
  ProjectConfiguration
>(builder: Builder<TPlatform, Credentials, ProjectConfiguration>): Promise<() => Promise<string>> {
  const credentialsResult = await withAnalyticsAsync(
    async () => await builder.ensureCredentialsAsync(builder.ctx),
    {
      successEvent: AnalyticsEvent.GATHER_CREDENTIALS_SUCCESS,
      failureEvent: AnalyticsEvent.GATHER_CREDENTIALS_FAIL,
      trackingCtx: builder.ctx.trackingCtx,
    }
  );
  if (!builder.ctx.commandCtx.skipProjectConfiguration) {
    await withAnalyticsAsync(async () => await builder.ensureProjectConfiguredAsync(builder.ctx), {
      successEvent: AnalyticsEvent.CONFIGURE_PROJECT_SUCCESS,
      failureEvent: AnalyticsEvent.CONFIGURE_PROJECT_FAIL,
      trackingCtx: builder.ctx.trackingCtx,
    });
  }

  if (!(await isGitStatusCleanAsync())) {
    log.addNewLineIfNone();
    const projectType = builder.ctx.platform === Platform.Android ? 'Android' : 'Xcode';
    // Currently we are only updaing runtime version durring build, but if it changes in a future
    // this message should also contain more info on that (or be more generic)
    await reviewAndCommitChangesAsync(`Update runtime version in the ${projectType} project`, {
      nonInteractive: builder.ctx.commandCtx.nonInteractive,
    });
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
      return await withAnalyticsAsync(
        async () => {
          if (log.isDebug) {
            log(`Starting ${platformDisplayNames[job.platform]} build`);
          }
          const {
            data: { buildId, deprecationInfo },
          } = await apiClient
            .post(`projects/${builder.ctx.commandCtx.projectId}/builds`, {
              json: {
                job,
                metadata,
              },
            })
            .json();
          printDeprecationWarnings(deprecationInfo);
          return buildId;
        },
        {
          successEvent: AnalyticsEvent.BUILD_REQUEST_SUCCESS,
          failureEvent: AnalyticsEvent.BUILD_REQUEST_FAIL,
          trackingCtx: builder.ctx.trackingCtx,
        }
      );
    } catch (error) {
      if (error.code === 'TURTLE_DEPRECATED_JOB_FORMAT') {
        log.error('EAS Build API changed, upgrade to latest expo-cli');
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
            message: 'Uploading to EAS Build',
            completedMessage: `Uploaded to EAS`,
          })
        );
        return bucketKey;
      },
      {
        successEvent: AnalyticsEvent.PROJECT_UPLOAD_SUCCESS,
        failureEvent: AnalyticsEvent.PROJECT_UPLOAD_FAIL,
        trackingCtx: ctx.trackingCtx,
      }
    );
  } finally {
    if (projectTarballPath) {
      await fs.remove(projectTarballPath);
    }
  }
}

async function withAnalyticsAsync<Result>(
  fn: () => Promise<Result>,
  analytics: {
    successEvent: AnalyticsEvent;
    failureEvent: AnalyticsEvent;
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
  commitMessage: string,
  { nonInteractive, askedFirstTime = true }: { nonInteractive: boolean; askedFirstTime?: boolean }
): Promise<void> {
  if (nonInteractive) {
    throw new Error(
      'Cannot commit changes when --non-interactive is specified. Run the command in interactive mode to review and commit changes.'
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
    await commitPromptAsync(commitMessage);
    log.withTick('Successfully committed changes.');
  } else if (selected === ShouldCommitChanges.ShowDiffFirst) {
    await showDiffAsync();
    await reviewAndCommitChangesAsync(commitMessage, { nonInteractive, askedFirstTime: false });
  }
}
