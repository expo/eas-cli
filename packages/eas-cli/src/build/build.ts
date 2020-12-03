import { Job } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import fs from 'fs-extra';

import { apiClient } from '../api';
import log from '../log';
import { UploadType, uploadAsync } from '../uploads';
import { createProgressTracker } from '../utils/progress';
import { platformDisplayNames } from './constants';
import { BuildContext } from './context';
import { collectMetadata } from './metadata';
import { AnalyticsEvent, Platform, TrackingContext } from './types';
import Analytics from './utils/analytics';
import { printDeprecationWarnings } from './utils/printBuildInfo';
import {
  isGitStatusCleanAsync,
  makeProjectTarballAsync,
  reviewAndCommitChangesAsync,
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
      archiveUrl: string;
      credentials?: Credentials;
      projectConfiguration?: ProjectConfiguration;
    }
  ): Promise<Job>;
}

export async function startBuildForPlatformAsync<
  TPlatform extends Platform,
  Credentials,
  ProjectConfiguration
>(builder: Builder<TPlatform, Credentials, ProjectConfiguration>): Promise<string> {
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

  await commitChangesForBuildAsync(builder.ctx.platform, {
    nonInteractive: builder.ctx.commandCtx.nonInteractive,
  });
  const archiveUrl = await uploadProjectAsync(builder.ctx);

  const metadata = collectMetadata(builder.ctx, {
    credentialsSource: credentialsResult?.source,
  });
  const job = await builder.prepareJobAsync(builder.ctx, {
    archiveUrl,
    credentials: credentialsResult?.credentials,
    projectConfiguration: builder.projectConfiguration,
  });

  try {
    return await withAnalyticsAsync(
      async () => {
        log(`Starting ${platformDisplayNames[job.platform]} build`);
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

        log('Uploading project to build servers');
        return await uploadAsync(
          UploadType.TURTLE_PROJECT_SOURCES,
          projectTarball.path,
          createProgressTracker(projectTarball.size)
        );
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
async function commitChangesForBuildAsync(
  platform: Platform,
  { nonInteractive }: { nonInteractive: boolean }
): Promise<void> {
  if (!(await isGitStatusCleanAsync())) {
    log.newLine();
    try {
      const projectType = platform === Platform.Android ? 'Android' : 'Xcode';
      await reviewAndCommitChangesAsync(`Update runtime version in the ${projectType} project`, {
        nonInteractive,
      });
    } catch (e) {
      throw new Error(
        "Aborting, run the command again once you're ready. Make sure to commit any changes you've made."
      );
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
