import {
  ArchiveSource,
  ArchiveSourceType,
  BuildJob,
  FingerprintSource,
  Metadata,
  Platform,
} from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import assert from 'assert';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import fs from 'fs-extra';
import { GraphQLError } from 'graphql/error';
import nullthrows from 'nullthrows';

import { BuildContext } from './context';
import {
  EasBuildDownForMaintenanceError,
  EasBuildFreeTierDisabledAndroidError,
  EasBuildFreeTierDisabledError,
  EasBuildFreeTierDisabledIOSError,
  EasBuildFreeTierIosLimitExceededError,
  EasBuildFreeTierLimitExceededError,
  EasBuildLegacyResourceClassNotAvailableError,
  EasBuildProjectArchiveUploadError,
  EasBuildResourceClassNotAvailableInFreeTierError,
  EasBuildTooManyPendingBuildsError,
  RequestValidationError,
  TurtleDeprecatedJobFormatError,
} from './errors';
import { transformMetadata } from './graphql';
import { LocalBuildMode, runLocalBuildAsync } from './local';
import { collectMetadataAsync } from './metadata';
import { printDeprecationWarnings } from './utils/printBuildInfo';
import {
  LocalFile,
  assertProjectTarballSizeDoesNotExceedLimit,
  makeProjectMetadataFileAsync,
  makeProjectTarballAsync,
  maybeWarnAboutProjectTarballSize,
  reviewAndCommitChangesAsync,
} from './utils/repository';
import { BuildEvent } from '../analytics/AnalyticsManager';
import { withAnalyticsAsync } from '../analytics/common';
import { getExpoWebsiteBaseUrl } from '../api';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../commandUtils/errors';
import {
  AppPlatform,
  BuildFragment,
  BuildParamsInput,
  BuildPriority,
  BuildStatus,
  UploadSessionType,
} from '../graphql/generated';
import { BuildMutation, BuildResult } from '../graphql/mutations/BuildMutation';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import Log, { learnMore, link } from '../log';
import { Ora, ora } from '../ora';
import {
  RequestedPlatform,
  appPlatformDisplayNames,
  appPlatformEmojis,
  requestedPlatformDisplayNames,
} from '../platform';
import { maybeUploadFingerprintAsync } from '../project/maybeUploadFingerprintAsync';
import { resolveRuntimeVersionAsync } from '../project/resolveRuntimeVersionAsync';
import { uploadFileAtPathToGCSAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createFingerprintAsync } from '../utils/fingerprintCli';
import { printJsonOnlyOutput } from '../utils/json';
import { createProgressTracker } from '../utils/progress';
import { sleepAsync } from '../utils/promise';

export interface CredentialsResult<Credentials> {
  source: CredentialsSource.LOCAL | CredentialsSource.REMOTE;
  credentials: Credentials;
}

export interface JobData<Credentials> {
  credentials?: Credentials;
  projectArchive: ArchiveSource;
}

interface Builder<TPlatform extends Platform, Credentials, TJob extends BuildJob> {
  ctx: BuildContext<TPlatform>;

  ensureCredentialsAsync(
    ctx: BuildContext<TPlatform>
  ): Promise<CredentialsResult<Credentials> | undefined>;
  syncProjectConfigurationAsync(ctx: BuildContext<TPlatform>): Promise<void>;
  prepareJobAsync(ctx: BuildContext<TPlatform>, jobData: JobData<Credentials>): Promise<BuildJob>;
  sendBuildRequestAsync(
    appId: string,
    job: TJob,
    metadata: Metadata,
    buildParams: BuildParamsInput
  ): Promise<BuildResult>;
}

export type BuildRequestSender = () => Promise<BuildFragment | undefined>;

function resolveBuildParamsInput<T extends Platform>(
  ctx: BuildContext<T>,
  metadata: Metadata
): BuildParamsInput {
  return {
    resourceClass: ctx.resourceClass,
    sdkVersion: metadata.sdkVersion,
    reactNativeVersion: metadata.reactNativeVersion,
  };
}

export async function prepareBuildRequestForPlatformAsync<
  TPlatform extends Platform,
  Credentials,
  TJob extends BuildJob,
>(builder: Builder<TPlatform, Credentials, TJob>): Promise<BuildRequestSender> {
  const { ctx } = builder;
  const credentialsResult = await withAnalyticsAsync(
    ctx.analytics,
    async () => await builder.ensureCredentialsAsync(ctx),
    {
      attemptEvent: BuildEvent.GATHER_CREDENTIALS_ATTEMPT,
      successEvent: BuildEvent.GATHER_CREDENTIALS_SUCCESS,
      failureEvent: BuildEvent.GATHER_CREDENTIALS_FAIL,
      properties: ctx.analyticsEventProperties,
    }
  );

  await withAnalyticsAsync(
    ctx.analytics,
    async () => {
      await builder.syncProjectConfigurationAsync(ctx);
    },
    {
      attemptEvent: BuildEvent.CONFIGURE_PROJECT_ATTEMPT,
      successEvent: BuildEvent.CONFIGURE_PROJECT_SUCCESS,
      failureEvent: BuildEvent.CONFIGURE_PROJECT_FAIL,
      properties: ctx.analyticsEventProperties,
    }
  );

  if (await ctx.vcsClient.isCommitRequiredAsync()) {
    Log.addNewLineIfNone();
    const platformToRequestedPlatform: Record<Platform, RequestedPlatform> = {
      [Platform.ANDROID]: RequestedPlatform.Android,
      [Platform.IOS]: RequestedPlatform.Ios,
    };
    await reviewAndCommitChangesAsync(
      ctx.vcsClient,
      `[EAS Build] Run EAS Build for ${
        requestedPlatformDisplayNames[platformToRequestedPlatform[ctx.platform]]
      }`,
      { nonInteractive: ctx.nonInteractive }
    );
  }

  let projectArchive: ArchiveSource | undefined;
  if (ctx.localBuildOptions.localBuildMode === LocalBuildMode.LOCAL_BUILD_PLUGIN) {
    const projectPath = (await makeProjectTarballAsync(ctx.vcsClient)).path;
    projectArchive = {
      type: ArchiveSourceType.PATH,
      path: projectPath,
    };
  } else if (ctx.localBuildOptions.localBuildMode === LocalBuildMode.INTERNAL) {
    projectArchive = {
      type: ArchiveSourceType.PATH,
      path: process.cwd(),
    };
  } else if (!ctx.localBuildOptions.localBuildMode) {
    projectArchive = {
      type: ArchiveSourceType.GCS,
      ...(await uploadProjectAsync(ctx)),
    };
  }
  assert(projectArchive);

  const runtimeAndFingerprintMetadata =
    await computeAndMaybeUploadRuntimeAndFingerprintMetadataAsync(ctx);
  const metadata = await collectMetadataAsync(ctx, runtimeAndFingerprintMetadata);
  const buildParams = resolveBuildParamsInput(ctx, metadata);
  const job = await builder.prepareJobAsync(ctx, {
    projectArchive,
    credentials: credentialsResult?.credentials,
  });

  return async () => {
    if (ctx.localBuildOptions.localBuildMode === LocalBuildMode.LOCAL_BUILD_PLUGIN) {
      await runLocalBuildAsync(job, metadata, ctx.localBuildOptions, ctx.env);
      return undefined;
    } else if (ctx.localBuildOptions.localBuildMode === LocalBuildMode.INTERNAL) {
      await BuildMutation.updateBuildMetadataAsync(ctx.graphqlClient, {
        buildId: nullthrows(process.env.EAS_BUILD_ID),
        metadata: transformMetadata(metadata),
      });
      printJsonOnlyOutput({ job, metadata });
      return undefined;
    } else if (!ctx.localBuildOptions.localBuildMode) {
      try {
        return await sendBuildRequestAsync(builder, job, metadata, buildParams);
      } catch (error: any) {
        handleBuildRequestError(error, job.platform);
      }
    } else {
      throw new Error('Unknown localBuildMode.');
    }
  };
}

const SERVER_SIDE_DEFINED_ERRORS: Record<string, typeof EasCommandError> = {
  TURTLE_DEPRECATED_JOB_FORMAT: TurtleDeprecatedJobFormatError,
  EAS_BUILD_FREE_TIER_DISABLED: EasBuildFreeTierDisabledError,
  EAS_BUILD_FREE_TIER_DISABLED_IOS: EasBuildFreeTierDisabledIOSError,
  EAS_BUILD_FREE_TIER_DISABLED_ANDROID: EasBuildFreeTierDisabledAndroidError,
  EAS_BUILD_FREE_TIER_LIMIT_EXCEEDED: EasBuildFreeTierLimitExceededError,
  EAS_BUILD_FREE_TIER_IOS_LIMIT_EXCEEDED: EasBuildFreeTierIosLimitExceededError,
  EAS_BUILD_RESOURCE_CLASS_NOT_AVAILABLE_IN_FREE_TIER:
    EasBuildResourceClassNotAvailableInFreeTierError,
  EAS_BUILD_LEGACY_RESOURCE_CLASS_NOT_AVAILABLE: EasBuildLegacyResourceClassNotAvailableError,
  VALIDATION_ERROR: RequestValidationError,
};

export function handleBuildRequestError(error: any, platform: Platform): never {
  Log.debug(JSON.stringify(error.graphQLErrors, null, 2));

  const graphQLErrorCode: string = error?.graphQLErrors?.[0]?.extensions?.errorCode;
  if (graphQLErrorCode in SERVER_SIDE_DEFINED_ERRORS) {
    const ErrorClass: typeof EasCommandError = SERVER_SIDE_DEFINED_ERRORS[graphQLErrorCode];
    throw new ErrorClass(error?.graphQLErrors?.[0]?.message);
  } else if (graphQLErrorCode === 'EAS_BUILD_DOWN_FOR_MAINTENANCE') {
    throw new EasBuildDownForMaintenanceError(
      `EAS Build is down for maintenance. Try again later. Check ${link(
        'https://status.expo.dev/'
      )} for updates.`
    );
  } else if (graphQLErrorCode === 'EAS_BUILD_TOO_MANY_PENDING_BUILDS') {
    throw new EasBuildTooManyPendingBuildsError(
      `You have already reached the maximum number of pending ${requestedPlatformDisplayNames[platform]} builds for your account. Try again later.`
    );
  } else if (error?.graphQLErrors) {
    const errorMessage = error.graphQLErrors
      .map((graphQLError: GraphQLError) => {
        const requestIdLine = graphQLError?.extensions?.requestId
          ? `\nRequest ID: ${graphQLError.extensions.requestId}`
          : '';
        const errorMessageLine = graphQLError?.message
          ? `\nError message: ${graphQLError.message}`
          : '';
        return `${requestIdLine}${errorMessageLine}`;
      })
      .join('');
    throw new Error(
      `Build request failed. Make sure you are using the latest eas-cli version. If the problem persists, report the issue.${errorMessage}`
    );
  }
  throw error;
}

async function uploadProjectAsync<TPlatform extends Platform>(
  ctx: BuildContext<TPlatform>
): Promise<{
  bucketKey: string;
  metadataLocation?: string;
}> {
  let projectTarballPath;
  try {
    return await withAnalyticsAsync(
      ctx.analytics,
      async () => {
        Log.newLine();
        Log.log(
          `Compressing project files and uploading to EAS Build. ${learnMore(
            'https://expo.fyi/eas-build-archive'
          )}`
        );
        const projectTarball = await makeProjectTarballAsync(ctx.vcsClient);

        maybeWarnAboutProjectTarballSize(projectTarball.size);
        assertProjectTarballSizeDoesNotExceedLimit(projectTarball.size);

        projectTarballPath = projectTarball.path;
        const [bucketKey, { metadataLocation }] = await Promise.all([
          uploadFileAtPathToGCSAsync(
            ctx.graphqlClient,
            UploadSessionType.EasBuildGcsProjectSources,
            projectTarball.path,
            createProgressTracker({
              total: projectTarball.size,
              message: ratio =>
                `Uploading to EAS Build (${formatBytes(
                  projectTarball.size * ratio
                )} / ${formatBytes(projectTarball.size)})`,
              completedMessage: (duration: string) => `Uploaded to EAS ${chalk.dim(duration)}`,
            })
          ),
          uploadMetadataFileAsync<TPlatform>(projectTarball, ctx),
        ]);

        if (metadataLocation) {
          return { bucketKey, metadataLocation };
        }
        return { bucketKey };
      },
      {
        attemptEvent: BuildEvent.PROJECT_UPLOAD_ATTEMPT,
        successEvent: BuildEvent.PROJECT_UPLOAD_SUCCESS,
        failureEvent: BuildEvent.PROJECT_UPLOAD_FAIL,
        properties: ctx.analyticsEventProperties,
      }
    );
  } catch (err: any) {
    let errMessage = 'Failed to upload the project tarball to EAS Build';

    if (err.message) {
      errMessage += `\n\nReason: ${err.message}`;
    }

    throw new EasBuildProjectArchiveUploadError(errMessage);
  } finally {
    if (projectTarballPath) {
      await fs.remove(projectTarballPath);
    }
  }
}

async function uploadMetadataFileAsync<TPlatform extends Platform>(
  projectTarball: LocalFile,
  ctx: BuildContext<TPlatform>
): Promise<{ metadataLocation: string | null }> {
  let projectMetadataFile: LocalFile | null = null;
  try {
    projectMetadataFile = await makeProjectMetadataFileAsync(projectTarball.path);

    const metadataLocation = await uploadFileAtPathToGCSAsync(
      ctx.graphqlClient,
      UploadSessionType.EasBuildGcsProjectMetadata,
      projectMetadataFile.path
    );
    return { metadataLocation };
  } catch (err: any) {
    let errMessage = 'Failed to upload metadata to EAS Build';

    if (err.message) {
      errMessage += `\n\nReason: ${err.message}`;
    }

    Log.warn(errMessage);
    return { metadataLocation: null };
  } finally {
    if (projectMetadataFile) {
      await fs.remove(projectMetadataFile.path);
    }
  }
}

async function sendBuildRequestAsync<
  TPlatform extends Platform,
  Credentials,
  TJob extends BuildJob,
>(
  builder: Builder<TPlatform, Credentials, TJob>,
  job: TJob,
  metadata: Metadata,
  buildParams: BuildParamsInput
): Promise<BuildFragment> {
  const { ctx } = builder;
  return await withAnalyticsAsync(
    ctx.analytics,
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
      properties: ctx.analyticsEventProperties,
    }
  );
}

export type MaybeBuildFragment = BuildFragment | null;

export async function waitForBuildEndAsync(
  graphqlClient: ExpoGraphqlClient,
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
    const builds = await getBuildsSafelyAsync(graphqlClient, buildIds);
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

async function getBuildsSafelyAsync(
  graphqlClient: ExpoGraphqlClient,
  buildIds: string[]
): Promise<MaybeBuildFragment[]> {
  const promises = buildIds.map(async buildId => {
    try {
      return await BuildQuery.byIdAsync(graphqlClient, buildId, { useCache: false });
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
  {
    build,
    accountName,
  }: {
    build: MaybeBuildFragment;
    accountName: string;
  },
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
      spinner.text = `Build concurrency limit reached for your account. Build will enter queue once a concurrency becomes available. Add additional concurrencies at ${link(
        formatAccountBillingUrl(accountName)
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
        typeof build.queuePosition === 'number' &&
        typeof build.estimatedWaitTimeLeftSeconds === 'number'
      ) {
        spinner.stopAndPersist();
        if (build.priority !== BuildPriority.High) {
          Log.newLine();
          Log.log('Start builds sooner in the priority queue.');
          Log.log(
            `Sign up for EAS Production or Enterprise at ${link(
              formatAccountBillingUrl(accountName)
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
    case BuildStatus.PendingCancel:
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
  [BuildPriority.Normal]: 'Free tier queue',
  [BuildPriority.NormalPlus]: 'Free tier queue',
  [BuildPriority.High]: 'priority queue',
};

const statusToDisplayName: Record<BuildStatus, string> = {
  [BuildStatus.New]: 'waiting to enter the queue (concurrency limit reached)',
  [BuildStatus.InQueue]: 'in queue',
  [BuildStatus.InProgress]: 'in progress',
  [BuildStatus.PendingCancel]: 'canceled',
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
      [
        BuildStatus.Finished,
        BuildStatus.Errored,
        BuildStatus.Canceled,
        BuildStatus.PendingCancel,
      ].includes(build.status)
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

function formatAccountBillingUrl(accountName: string): string {
  return new URL(`/accounts/${accountName}/settings/billing`, getExpoWebsiteBaseUrl()).toString();
}

async function computeAndMaybeUploadRuntimeAndFingerprintMetadataAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<{
  runtimeVersion?: string | undefined;
  fingerprintHash?: string | undefined;
  fingerprintSource?: FingerprintSource | undefined;
}> {
  const runtimeAndFingerprintMetadata =
    await computeAndMaybeUploadFingerprintFromExpoUpdatesAsync(ctx);
  if (!runtimeAndFingerprintMetadata?.fingerprintHash) {
    const fingerprint = await computeAndMaybeUploadFingerprintWithoutExpoUpdatesAsync(ctx);
    return {
      ...runtimeAndFingerprintMetadata,
      ...fingerprint,
    };
  } else {
    return {
      ...runtimeAndFingerprintMetadata,
      fingerprintHash: runtimeAndFingerprintMetadata.runtimeVersion,
    };
  }
}

async function computeAndMaybeUploadFingerprintFromExpoUpdatesAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<{
  runtimeVersion?: string;
  fingerprintSource?: FingerprintSource;
  fingerprintHash?: string;
}> {
  const resolvedRuntimeVersion = await resolveRuntimeVersionAsync({
    exp: ctx.exp,
    platform: ctx.platform,
    workflow: ctx.workflow,
    projectDir: ctx.projectDir,
    env: ctx.env,
    cwd: ctx.projectDir,
  });

  if (!resolvedRuntimeVersion) {
    return {};
  }

  /**
   * It's ok for fingerprintSources or runtimeVersion to be empty
   * fingerprintSources only exist if the project is using runtimeVersion.policy: fingerprint
   */
  if (
    !resolvedRuntimeVersion.expoUpdatesRuntimeFingerprint ||
    !resolvedRuntimeVersion.runtimeVersion
  ) {
    return {
      runtimeVersion: resolvedRuntimeVersion.runtimeVersion ?? undefined,
    };
  }

  const uploadedFingerprint = await maybeUploadFingerprintAsync({
    hash: resolvedRuntimeVersion.runtimeVersion,
    fingerprint: resolvedRuntimeVersion.expoUpdatesRuntimeFingerprint,
    graphqlClient: ctx.graphqlClient,
    localBuildMode: ctx.localBuildOptions.localBuildMode,
  });
  return {
    runtimeVersion: uploadedFingerprint.hash,
    fingerprintSource: uploadedFingerprint.fingerprintSource,
    fingerprintHash: resolvedRuntimeVersion.expoUpdatesRuntimeFingerprintHash ?? undefined,
  };
}

async function computeAndMaybeUploadFingerprintWithoutExpoUpdatesAsync<T extends Platform>(
  ctx: BuildContext<T>,
  { debug }: { debug?: boolean } = {}
): Promise<{
  fingerprintHash?: string;
  fingerprintSource?: FingerprintSource;
}> {
  const fingerprint = await createFingerprintAsync(ctx.projectDir, {
    workflow: ctx.workflow,
    platforms: [ctx.platform],
    env: ctx.env,
  });
  if (!fingerprint) {
    return {};
  }
  const uploadedFingerprint = await maybeUploadFingerprintAsync({
    hash: fingerprint.hash,
    fingerprint: {
      fingerprintSources: fingerprint.sources,
      isDebugFingerprintSource: debug ?? false,
    },
    graphqlClient: ctx.graphqlClient,
    localBuildMode: ctx.localBuildOptions.localBuildMode,
  });
  return {
    fingerprintHash: uploadedFingerprint.hash,
    fingerprintSource: uploadedFingerprint.fingerprintSource,
  };
}
