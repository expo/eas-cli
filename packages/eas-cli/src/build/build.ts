import { CredentialsSource } from '@eas/config';
import { Job } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { apiClient } from '../api';
import log from '../log';
import { UploadType, uploadAsync } from '../uploads';
import { getTmpDirectory } from '../utils/paths';
import { createProgressTracker } from '../utils/progress';
import { platformDisplayNames } from './constants';
import { BuildContext } from './context';
import { collectMetadata } from './metadata';
import { AnalyticsEvent, Platform } from './types';
import Analytics from './utils/analytics';
import { makeProjectTarballAsync } from './utils/git';
import { printDeprecationWarnings } from './utils/printBuildInfo';

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
  await fs.mkdirp(getTmpDirectory());
  const tarPath = path.join(getTmpDirectory(), `${uuidv4()}.tar.gz`);
  try {
    let credentialsResult: CredentialsResult<Credentials> | undefined;
    try {
      credentialsResult = await builder.ensureCredentialsAsync(builder.ctx);
      Analytics.logEvent(
        AnalyticsEvent.GATHER_CREDENTIALS_SUCCESS,
        builder.ctx.trackingCtx.properties
      );
    } catch (error) {
      Analytics.logEvent(AnalyticsEvent.GATHER_CREDENTIALS_FAIL, {
        ...builder.ctx.trackingCtx,
        reason: error.message,
      });
      throw error;
    }
    if (!builder.ctx.commandCtx.skipProjectConfiguration) {
      try {
        await builder.ensureProjectConfiguredAsync(builder.ctx);

        Analytics.logEvent(
          AnalyticsEvent.CONFIGURE_PROJECT_SUCCESS,
          builder.ctx.trackingCtx.properties
        );
      } catch (error) {
        Analytics.logEvent(AnalyticsEvent.CONFIGURE_PROJECT_FAIL, {
          ...builder.ctx.trackingCtx,
          reason: error.message,
        });
        throw error;
      }
    }

    let archiveUrl;
    try {
      const fileSize = await makeProjectTarballAsync(tarPath);

      log('Uploading project to AWS S3');
      archiveUrl = await uploadAsync(
        UploadType.TURTLE_PROJECT_SOURCES,
        tarPath,
        createProgressTracker(fileSize)
      );
      Analytics.logEvent(AnalyticsEvent.PROJECT_UPLOAD_SUCCESS, builder.ctx.trackingCtx.properties);
    } catch (error) {
      Analytics.logEvent(AnalyticsEvent.PROJECT_UPLOAD_FAIL, {
        ...builder.ctx.trackingCtx,
        reason: error.message,
      });
      throw error;
    }

    const metadata = await collectMetadata(builder.ctx, {
      credentialsSource: credentialsResult?.source,
    });
    const job = await builder.prepareJobAsync(builder.ctx, {
      archiveUrl,
      credentials: credentialsResult?.credentials,
      projectConfiguration: builder.projectConfiguration,
    });
    log(`Starting ${platformDisplayNames[job.platform]} build`);

    try {
      const {
        data: { buildId, deprecationInfo },
      } = await apiClient
        .post(`projects/${builder.ctx.projectId}/builds`, {
          json: {
            job,
            metadata,
          },
        })
        .json();
      printDeprecationWarnings(deprecationInfo);
      Analytics.logEvent(AnalyticsEvent.BUILD_REQUEST_SUCCESS, builder.ctx.trackingCtx.properties);
      return buildId;
    } catch (error) {
      Analytics.logEvent(AnalyticsEvent.BUILD_REQUEST_FAIL, {
        ...builder.ctx.trackingCtx,
        reason: error.message,
      });
      if (error.code === 'TURTLE_DEPRECATED_JOB_FORMAT') {
        log.error('EAS Build API changed, upgrade to latest expo-cli');
      }
      throw error;
    }
  } finally {
    await fs.remove(tarPath);
  }
}
