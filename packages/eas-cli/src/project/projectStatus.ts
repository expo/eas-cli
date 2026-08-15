import chalk from 'chalk';

import {
  getBuildLogsUrl,
  getProjectDashboardUrl,
  getSubmissionUrl,
  getUpdateGroupUrl,
  getWorkflowRunUrl,
} from '../build/utils/url';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { WorkflowRunResult } from '../commandUtils/workflow/types';
import { processWorkflowRuns } from '../commandUtils/workflow/utils';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  DistributionType,
  SubmissionAndroidReleaseStatus,
  SubmissionStatus,
  UpdateFragment,
  WorkflowRunStatus,
} from '../graphql/generated';
import { AppQuery } from '../graphql/queries/AppQuery';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import { ProjectStatusSubmission, SubmissionQuery } from '../graphql/queries/SubmissionQuery';
import { UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log from '../log';
import { appPlatformDisplayNames } from '../platform';
import { getActorDisplayName } from '../user/User';
import { fromNow } from '../utils/date';

export const PROJECT_STATUS_DEFAULT_LIMIT = 3;

export interface ProjectStatusSummary {
  generatedAt: string;
  limit: number;
  hasMore: {
    productionBuilds: boolean;
    developmentBuilds: boolean;
    workflowRuns: boolean;
    submissions: boolean;
    updates: boolean;
  };
  project: {
    id: string;
    name: string;
    fullName: string;
    slug: string;
    account: string;
    url: string;
  };
  productionBuilds: BuildStatusSummary[];
  developmentBuilds: BuildStatusSummary[];
  workflowRuns: WorkflowRunStatusSummary[];
  submissions: SubmissionStatusSummary[];
  updates: UpdateStatusSummary[];
}

interface ActivityErrorSummary {
  code: string | null;
  message: string | null;
}

interface BuildStatusSummary {
  id: string;
  platform: AppPlatform;
  status: BuildStatus;
  distribution: DistributionType | null;
  buildProfile: string | null;
  appVersion: string | null;
  appBuildVersion: string | null;
  runtimeVersion: string | null;
  sdkVersion: string | null;
  channel: string | null;
  gitCommitHash: string | null;
  gitCommitMessage: string | null;
  message: string | null;
  initiatingActor: string | null;
  createdAt: string;
  completedAt: string | null;
  url: string;
  error: (ActivityErrorSummary & { docsUrl: string | null }) | null;
}

interface SubmissionStatusSummary {
  id: string;
  platform: AppPlatform;
  status: SubmissionStatus;
  appIdentifier: string | null;
  androidTrack: string | null;
  androidReleaseStatus: SubmissionAndroidReleaseStatus | null;
  rollout: number | null;
  buildId: string | null;
  initiatingActor: string | null;
  createdAt: string;
  completedAt: string | null;
  url: string;
  error: ActivityErrorSummary | null;
}

interface WorkflowRunStatusSummary extends WorkflowRunResult {
  errors: {
    title: string | null;
    message: string;
  }[];
  url: string;
}

interface UpdateStatusSummary {
  group: string;
  branch: string;
  message: string | null;
  runtimeVersion: string;
  platforms: string[];
  isRollBackToEmbedded: boolean;
  gitCommitHash: string | null;
  rolloutPercentage: number | null;
  environment: unknown | null;
  initiatingActor: string | null;
  createdAt: string;
  url: string;
}

export async function getProjectStatusAsync(
  graphqlClient: ExpoGraphqlClient,
  { projectId, limit }: { projectId: string; limit: number }
): Promise<ProjectStatusSummary> {
  const queryLimitForHasMore = limit + 1;
  const [app, productionBuilds, developmentBuilds, workflowRuns, submissions, updateGroups] =
    await Promise.all([
      AppQuery.byIdAsync(graphqlClient, projectId),
      BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId: projectId,
        limit: queryLimitForHasMore,
        offset: 0,
        filter: { developmentClient: false, distribution: DistributionType.Store },
      }),
      BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId: projectId,
        limit: queryLimitForHasMore,
        offset: 0,
        filter: { developmentClient: true },
      }),
      AppQuery.byIdWorkflowRunsFilteredByStatusAsync(
        graphqlClient,
        projectId,
        undefined,
        queryLimitForHasMore
      ),
      SubmissionQuery.forProjectStatusAsync(graphqlClient, projectId, {
        limit: queryLimitForHasMore,
        offset: 0,
      }),
      UpdateQuery.viewUpdateGroupsOnAppAsync(graphqlClient, {
        appId: projectId,
        limit: queryLimitForHasMore,
        offset: 0,
      }),
    ]);

  const accountName = app.ownerAccount.name;
  const projectName = app.slug;
  const limitedWorkflowRuns = workflowRuns.slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    limit,
    hasMore: {
      productionBuilds: productionBuilds.length > limit,
      developmentBuilds: developmentBuilds.length > limit,
      workflowRuns: workflowRuns.length > limit,
      submissions: submissions.length > limit,
      updates: updateGroups.length > limit,
    },
    project: {
      id: app.id,
      name: app.name,
      fullName: app.fullName,
      slug: app.slug,
      account: accountName,
      url: getProjectDashboardUrl(accountName, projectName),
    },
    productionBuilds: productionBuilds.slice(0, limit).map(toBuildSummary),
    developmentBuilds: developmentBuilds.slice(0, limit).map(toBuildSummary),
    workflowRuns: processWorkflowRuns(limitedWorkflowRuns).map((run, index) => ({
      ...run,
      errors: limitedWorkflowRuns[index].errors.map(error => ({
        title: error.title ?? null,
        message: error.message,
      })),
      url: getWorkflowRunUrl(accountName, projectName, run.id),
    })),
    submissions: submissions
      .slice(0, limit)
      .map(submission => toSubmissionSummary(submission, accountName, projectName)),
    updates: updateGroups
      .slice(0, limit)
      .map(updateGroup => toUpdateSummary(updateGroup, accountName, projectName)),
  };
}

function toBuildSummary(build: BuildFragment): BuildStatusSummary {
  return {
    id: build.id,
    platform: build.platform,
    status: build.status,
    distribution: build.distribution ?? null,
    buildProfile: build.buildProfile ?? null,
    appVersion: build.appVersion ?? null,
    appBuildVersion: build.appBuildVersion ?? null,
    runtimeVersion: build.runtime?.version ?? null,
    sdkVersion: build.sdkVersion ?? null,
    channel: build.updateChannel?.name ?? null,
    gitCommitHash: build.gitCommitHash ?? null,
    gitCommitMessage: build.gitCommitMessage?.split('\n')[0] ?? null,
    message: build.message ?? null,
    initiatingActor: build.initiatingActor?.displayName ?? null,
    createdAt: build.createdAt,
    completedAt: build.completedAt ?? null,
    url: getBuildLogsUrl(build),
    error: build.error
      ? {
          code: build.error.errorCode,
          message: build.error.message,
          docsUrl: build.error.docsUrl ?? null,
        }
      : null,
  };
}

function toSubmissionSummary(
  submission: ProjectStatusSubmission,
  accountName: string,
  projectName: string
): SubmissionStatusSummary {
  return {
    id: submission.id,
    platform: submission.platform,
    status: submission.status,
    appIdentifier:
      submission.androidConfig?.applicationIdentifier ??
      submission.iosConfig?.ascAppIdentifier ??
      null,
    androidTrack: submission.androidConfig?.track ?? null,
    androidReleaseStatus: submission.androidConfig?.releaseStatus ?? null,
    rollout: submission.androidConfig?.rollout ?? null,
    buildId: submission.submittedBuild?.id ?? null,
    initiatingActor: submission.initiatingActor?.displayName ?? null,
    createdAt: submission.createdAt,
    completedAt: submission.completedAt ?? null,
    url: getSubmissionUrl(accountName, projectName, submission.id),
    error: submission.error
      ? {
          code: submission.error.errorCode ?? null,
          message: submission.error.message ?? null,
        }
      : null,
  };
}

function toUpdateSummary(
  updateGroup: UpdateFragment[],
  accountName: string,
  projectName: string
): UpdateStatusSummary {
  const representativeUpdate = updateGroup[0];
  const platforms = [...new Set(updateGroup.map(update => update.platform))].sort();
  return {
    group: representativeUpdate.group,
    branch: representativeUpdate.branch.name,
    message: representativeUpdate.message ?? null,
    runtimeVersion: representativeUpdate.runtime.version,
    platforms,
    isRollBackToEmbedded: representativeUpdate.isRollBackToEmbedded,
    gitCommitHash: representativeUpdate.gitCommitHash ?? null,
    rolloutPercentage: representativeUpdate.rolloutPercentage ?? null,
    environment: representativeUpdate.environment ?? null,
    initiatingActor: representativeUpdate.actor
      ? getActorDisplayName(representativeUpdate.actor)
      : null,
    createdAt: representativeUpdate.createdAt,
    url: getUpdateGroupUrl(accountName, projectName, representativeUpdate.group),
  };
}

export function printProjectStatusAsText(status: ProjectStatusSummary): void {
  Log.addNewLineIfNone();
  Log.log(chalk.bold(status.project.fullName));
  Log.log(chalk.dim(status.project.url));

  renderSection(
    'Production builds',
    status.productionBuilds,
    renderBuild,
    status.hasMore.productionBuilds
  );
  renderSection(
    'Development builds',
    status.developmentBuilds,
    renderBuild,
    status.hasMore.developmentBuilds
  );
  renderSection(
    'Workflow runs',
    status.workflowRuns,
    renderWorkflowRun,
    status.hasMore.workflowRuns
  );
  renderSection('Submissions', status.submissions, renderSubmission, status.hasMore.submissions);
  renderSection('Updates', status.updates, renderUpdate, status.hasMore.updates);
}

function renderSection<T>(
  title: string,
  items: T[],
  renderItem: (item: T) => string,
  hasMore: boolean
): void {
  Log.newLine();
  Log.log(chalk.bold(title));
  if (items.length === 0) {
    Log.log(chalk.dim('  None'));
    return;
  }
  for (const item of items) {
    Log.log(renderItem(item));
  }
  if (hasMore) {
    Log.log(chalk.dim('  More available; use --limit to show more.'));
  }
}

function renderBuild(build: BuildStatusSummary): string {
  const lines = [
    `  ${joinMeta([
      colorBuildStatus(build.status),
      appPlatformDisplayNames[build.platform],
      build.buildProfile,
      timeAgo(build.createdAt),
    ])}`,
  ];
  const version = build.appVersion
    ? `${build.appVersion}${build.appBuildVersion ? ` (${build.appBuildVersion})` : ''}`
    : null;
  if (version) {
    lines.push(`    ${chalk.dim('version')}  ${version}`);
  }
  if (build.gitCommitMessage) {
    lines.push(`    ${chalk.dim(shortHash(build.gitCommitHash))}  ${build.gitCommitMessage}`);
  }
  if (build.error?.message) {
    lines.push(`    ${chalk.red(build.error.message)}`);
  }
  lines.push(`    ${chalk.dim(build.url)}`);
  return lines.join('\n');
}

function renderWorkflowRun(run: WorkflowRunStatusSummary): string {
  const lines = [
    `  ${joinMeta([
      colorWorkflowStatus(run.status),
      run.workflowName ?? run.workflowFileName,
      timeAgo(run.startedAt),
    ])}`,
  ];
  if (run.gitCommitMessage) {
    lines.push(`    ${chalk.dim(shortHash(run.gitCommitHash))}  ${run.gitCommitMessage}`);
  }
  for (const error of run.errors) {
    lines.push(`    ${chalk.red(error.message)}`);
  }
  lines.push(`    ${chalk.dim(run.url)}`);
  return lines.join('\n');
}

function renderSubmission(submission: SubmissionStatusSummary): string {
  const lines = [
    `  ${joinMeta([
      colorSubmissionStatus(submission.status),
      appPlatformDisplayNames[submission.platform],
      submission.androidTrack ? `track: ${submission.androidTrack}` : null,
      timeAgo(submission.createdAt),
    ])}`,
  ];
  if (submission.buildId) {
    lines.push(`    ${chalk.dim('build')}  ${submission.buildId}`);
  }
  if (submission.error?.message) {
    lines.push(`    ${chalk.red(submission.error.message)}`);
  }
  lines.push(`    ${chalk.dim(submission.url)}`);
  return lines.join('\n');
}

function renderUpdate(update: UpdateStatusSummary): string {
  const lines = [
    `  ${joinMeta([
      chalk.cyan(update.branch),
      update.platforms.join(', '),
      `runtime: ${update.runtimeVersion}`,
      timeAgo(update.createdAt),
    ])}`,
  ];
  const message = update.isRollBackToEmbedded ? 'Roll back to embedded' : update.message;
  if (message) {
    lines.push(`    ${chalk.dim(shortHash(update.gitCommitHash))}  ${message}`);
  }
  lines.push(`    ${chalk.dim(update.url)}`);
  return lines.join('\n');
}

function joinMeta(parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(chalk.dim(' · '));
}

function timeAgo(isoDate: string | null): string | null {
  if (!isoDate) {
    return null;
  }
  return `${fromNow(new Date(isoDate))} ago`;
}

function shortHash(hash: string | null): string {
  return hash ? hash.slice(0, 7) : '-------';
}

function colorBuildStatus(status: BuildStatus): string {
  switch (status) {
    case BuildStatus.Finished:
      return chalk.green('finished');
    case BuildStatus.Errored:
      return chalk.red('errored');
    case BuildStatus.Canceled:
    case BuildStatus.PendingCancel:
      return chalk.gray('canceled');
    case BuildStatus.New:
    case BuildStatus.InQueue:
    case BuildStatus.InProgress:
      return chalk.blue(status.toLowerCase().replace(/_/g, ' '));
    default:
      return String(status).toLowerCase().replace(/_/g, ' ');
  }
}

function colorSubmissionStatus(status: SubmissionStatus): string {
  switch (status) {
    case SubmissionStatus.Finished:
      return chalk.green('finished');
    case SubmissionStatus.Errored:
      return chalk.red('errored');
    case SubmissionStatus.Canceled:
      return chalk.gray('canceled');
    default:
      return chalk.blue(status.toLowerCase().replace(/_/g, ' '));
  }
}

function colorWorkflowStatus(status: string): string {
  switch (status) {
    case WorkflowRunStatus.Success:
      return chalk.green('success');
    case WorkflowRunStatus.Failure:
      return chalk.red('failure');
    case WorkflowRunStatus.Canceled:
      return chalk.gray('canceled');
    case WorkflowRunStatus.ActionRequired:
      return chalk.yellow('action required');
    case WorkflowRunStatus.New:
    case WorkflowRunStatus.InProgress:
      return chalk.blue(status.toLowerCase().replace(/_/g, ' '));
    default:
      return status.toLowerCase();
  }
}
