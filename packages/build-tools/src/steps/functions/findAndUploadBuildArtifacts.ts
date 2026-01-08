import { ManagedArtifactType, Ios, Platform, BuildJob } from '@expo/eas-build-job';
import { BuildFunction, BuildStepContext } from '@expo/steps';

import { findArtifacts } from '../../utils/artifacts';
import { findXcodeBuildLogsPathAsync } from '../../ios/xcodeBuildLogs';
import { CustomBuildContext } from '../../customBuildContext';

export function createFindAndUploadBuildArtifactsBuildFunction(
  ctx: CustomBuildContext<BuildJob>
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'find_and_upload_build_artifacts',
    name: 'Find and upload build artifacts',
    __metricsId: 'eas/find_and_upload_build_artifacts',
    fn: async (stepCtx) => {
      // We want each upload to print logs on its own
      // and we don't want to interleave logs from different uploads
      // so we execute uploads consecutively.
      // Both application archive and build artifact uploads errors
      // are throwing. We count the former as more important,
      // so we save its for final throw.

      let firstError: any = null;

      try {
        await uploadApplicationArchivesAsync({ ctx, stepCtx });
      } catch (err: unknown) {
        stepCtx.logger.error(`Failed to upload application archives.`, err);
        firstError ||= err;
      }

      try {
        await uploadBuildArtifacts({ ctx, stepCtx });
      } catch (err: unknown) {
        stepCtx.logger.error(`Failed to upload build artifacts.`, err);
        firstError ||= err;
      }

      if (ctx.job.platform === Platform.IOS) {
        try {
          await uploadXcodeBuildLogs({ ctx, stepCtx });
        } catch (err: unknown) {
          stepCtx.logger.error(`Failed to upload Xcode build logs.`, err);
        }
      }

      if (firstError) {
        throw firstError;
      }
    },
  });
}

function resolveIosArtifactPath(job: Ios.Job): string {
  if (job.applicationArchivePath) {
    return job.applicationArchivePath;
  } else if (job.simulator) {
    return 'ios/build/Build/Products/*simulator/*.app';
  } else {
    return 'ios/build/*.ipa';
  }
}

async function uploadApplicationArchivesAsync({
  ctx,
  stepCtx: { workingDirectory, logger },
}: {
  ctx: CustomBuildContext<BuildJob>;
  stepCtx: BuildStepContext;
}): Promise<void> {
  const applicationArchivePatternOrPath =
    ctx.job.platform === Platform.ANDROID
      ? ctx.job.applicationArchivePath ?? 'android/app/build/outputs/**/*.{apk,aab}'
      : resolveIosArtifactPath(ctx.job);
  const applicationArchives = await findArtifacts({
    rootDir: workingDirectory,
    patternOrPath: applicationArchivePatternOrPath,
    logger,
  });

  if (applicationArchives.length === 0) {
    throw new Error(`Found no application archives for "${applicationArchivePatternOrPath}".`);
  }

  const count = applicationArchives.length;
  logger.info(
    `Found ${count} application archive${count > 1 ? 's' : ''}:\n- ${applicationArchives.join(
      '\n- '
    )}`
  );

  logger.info('Uploading...');
  await ctx.runtimeApi.uploadArtifact({
    artifact: {
      type: ManagedArtifactType.APPLICATION_ARCHIVE,
      paths: applicationArchives,
    },
    logger,
  });
  logger.info('Done.');
}

async function uploadBuildArtifacts({
  ctx,
  stepCtx: { workingDirectory, logger },
}: {
  ctx: CustomBuildContext<BuildJob>;
  stepCtx: BuildStepContext;
}): Promise<void> {
  const buildArtifacts = (
    await Promise.all(
      (ctx.job.buildArtifactPaths ?? []).map((path) =>
        findArtifacts({ rootDir: workingDirectory, patternOrPath: path, logger })
      )
    )
  ).flat();
  if (buildArtifacts.length === 0) {
    return;
  }

  logger.info(`Found additional build artifacts:\n- ${buildArtifacts.join('\n- ')}`);
  logger.info('Uploading...');
  await ctx.runtimeApi.uploadArtifact({
    artifact: {
      type: ManagedArtifactType.BUILD_ARTIFACTS,
      paths: buildArtifacts,
    },
    logger,
  });
  logger.info('Done.');
}

async function uploadXcodeBuildLogs({
  ctx,
  stepCtx: { logger, global },
}: {
  ctx: CustomBuildContext;
  stepCtx: BuildStepContext;
}): Promise<void> {
  const xcodeBuildLogsPath = await findXcodeBuildLogsPathAsync(global.buildLogsDirectory);
  if (!xcodeBuildLogsPath) {
    return;
  }

  logger.info(`Found Xcode build logs.`);
  logger.info('Uploading...');
  await ctx.runtimeApi.uploadArtifact({
    artifact: {
      type: ManagedArtifactType.XCODE_BUILD_LOGS,
      paths: [xcodeBuildLogsPath],
    },
    logger,
  });
  logger.info('Done.');
}
