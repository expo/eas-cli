import {
  BuildContext,
  BuildContextOptions,
  LogBuffer,
  RuntimeSettings,
  getDeviceRunSessionTokenFromEnvironmentSecrets,
} from '@expo/build-tools';
import { Job, ManagedArtifactType, Metadata, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import assert from 'assert';
import { Transform } from 'stream';

import { GCSCacheManager } from './CacheManager';
import config from './config';
import { getBuildEnv } from './env';
import { Analytics } from './external/analytics';
import { uploadXcodeBuildLogs } from './ios/xcodeLogs';
import { maybeStopWarmSimulatorAsync } from './warmSimulator';
import { prepareRuntimeEnvironmentConfigFiles } from './runtimeEnvironment';
import sentry from './sentry';
import {
  uploadApplicationArchiveAsync,
  uploadBuildArtifactsAsync,
  uploadSourceMapAsync,
  uploadWithAnalyticsAsync,
  uploadWorkflowArtifactAsync,
} from './upload';

export async function createBuildContext<TJob extends Job>({
  job,
  logBuffer,
  analytics,
  metadata,
  projectId,
  buildId,
  buildLogger,
  addBuildLogMask,
  createLogMaskingStream,
}: {
  job: TJob;
  logBuffer: LogBuffer;
  analytics: Analytics;
  metadata: Metadata;
  projectId: string;
  buildId: string;
  buildLogger: bunyan;
  addBuildLogMask: (secret: string) => void;
  createLogMaskingStream: () => Transform;
}): Promise<BuildContext<TJob>> {
  const childLogger = buildLogger.child({ buildId });
  await RuntimeSettings.loadAsync({
    environment: config.env,
    env: job.builderEnvironment?.env,
  });
  // Build-tools waits for the launcher's own cleanup record before it changes a Simulator.
  void maybeStopWarmSimulatorAsync(job).catch(err => {
    childLogger.warn({ err }, 'Could not stop warm Simulator services.');
  });
  await prepareRuntimeEnvironmentConfigFiles();
  const env = getBuildEnv({ job, projectId, metadata, buildId });

  const uploadArtifact: BuildContextOptions['uploadArtifact'] = async ({ artifact, logger }) => {
    const { paths, type } = artifact;

    switch (type) {
      case ManagedArtifactType.XCODE_BUILD_LOGS: {
        if (job.platform === Platform.IOS) {
          await uploadXcodeBuildLogs(logger, paths[0], createLogMaskingStream);
          return { filename: null };
        }
        throw new Error('Uploading Xcode logs in non-iOS builds is not supported');
      }
      case ManagedArtifactType.APPLICATION_ARCHIVE: {
        assert(job.platform, 'Uploading application archives outside of builds is not supported.');
        return await uploadWithAnalyticsAsync(
          () => uploadApplicationArchiveAsync(ctx, { artifactPaths: paths, buildId, logger }),
          analytics
        );
      }
      case ManagedArtifactType.BUILD_ARTIFACTS: {
        assert(job.platform, 'Uploading build artifacts outside of builds is not supported.');
        return await uploadWithAnalyticsAsync(
          () => uploadBuildArtifactsAsync(ctx, { artifactPaths: paths, buildId, logger }),
          analytics
        );
      }
      case ManagedArtifactType.SOURCE_MAP: {
        assert(job.platform, 'Uploading source maps outside of builds is not supported.');
        return await uploadWithAnalyticsAsync(
          () => uploadSourceMapAsync(ctx, { sourceMapPath: paths[0], buildId, logger }),
          analytics
        );
      }
      default: {
        return await uploadWithAnalyticsAsync(
          () =>
            uploadWorkflowArtifactAsync(ctx, {
              artifactPaths: paths,
              logger,
              name: artifact.name,
              metadata: artifact.metadata,
            }),
          analytics
        );
      }
    }
  };

  const ctx = new BuildContext<TJob>(job, {
    workingdir: config.workingdir,
    logger: childLogger,
    logBuffer,
    env,
    uploadArtifact,
    reportError: (msg, err, { tags, extras } = {}) => {
      childLogger.error({ tags, extras, err }, msg);
      sentry.capture(msg, err, { tags, extras });
    },
    cacheManager: new GCSCacheManager(),
    metadata,
    expoApiV2BaseUrl: config.wwwApiV2BaseUrl,
    mcpServerUrl: config.mcpServerUrl,
    addBuildLogMask,
  });
  setDeviceRunSessionSentryTags(ctx, buildId);
  return ctx;
}

/**
 * Tags every later Sentry event from this worker with the device run session and its job run, so
 * an error in Sentry can be traced to one session. A worker runs one job, so the tags stay correct.
 */
function setDeviceRunSessionSentryTags(ctx: BuildContext<Job>, jobRunId: string): void {
  const deviceRunSessionId = ctx.env.DEVICE_RUN_SESSION_ID;
  // Same check as the Datadog setup in service.ts: only the job of a device run session has a
  // session token, and only a job run (no platform) has a job run ID.
  const isDeviceRunSessionJob =
    !ctx.job.platform &&
    Boolean(getDeviceRunSessionTokenFromEnvironmentSecrets(ctx.job.secrets?.environmentSecrets));
  if (isDeviceRunSessionJob && deviceRunSessionId) {
    sentry.setTags({ deviceRunSessionId, jobRunId });
  }
}
