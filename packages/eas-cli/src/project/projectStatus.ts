import chalk from 'chalk';

import { getBuildLogsUrl, getProjectDashboardUrl } from '../build/utils/url';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { WorkflowRunResult } from '../commandUtils/workflow/types';
import { processWorkflowRuns } from '../commandUtils/workflow/utils';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  DistributionType,
  SubmissionFragment,
  SubmissionStatus,
  UpdateFragment,
  WorkflowRunStatus,
} from '../graphql/generated';
import { AppQuery } from '../graphql/queries/AppQuery';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import { SubmissionQuery } from '../graphql/queries/SubmissionQuery';
import { UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log from '../log';
import { appPlatformDisplayNames } from '../platform';
import { fromNow } from '../utils/date';

export const PROJECT_STATUS_DEFAULT_LIMIT = 3;

export interface ProjectStatusSummary {
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
  workflowRuns: WorkflowRunResult[];
  submissions: SubmissionStatusSummary[];
  updates: UpdateStatusSummary[];
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
}

interface SubmissionStatusSummary {
  id: string;
  platform: AppPlatform;
  status: SubmissionStatus;
  androidTrack: string | null;
  error: string | null;
}

interface UpdateStatusSummary {
  group: string;
  branch: string;
  message: string | null;
  runtimeVersion: string;
  platforms: string;
  isRollBackToEmbedded: boolean;
  gitCommitHash: string | null;
  createdAt: string;
}

export async function getProjectStatusAsync(
  graphqlClient: ExpoGraphqlClient,
  { projectId, limit }: { projectId: string; limit: number }
): Promise<ProjectStatusSummary> {
  const [app, productionBuilds, developmentBuilds, workflowRuns, submissions, updateGroups] =
    await Promise.all([
      AppQuery.byIdAsync(graphqlClient, projectId),
      BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId: projectId,
        limit,
        offset: 0,
        filter: { developmentClient: false, distribution: DistributionType.Store },
      }),
      BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId: projectId,
        limit,
        offset: 0,
        filter: { developmentClient: true },
      }),
      AppQuery.byIdWorkflowRunsFilteredByStatusAsync(graphqlClient, projectId, undefined, limit),
      SubmissionQuery.allForAppAsync(graphqlClient, projectId, { limit, offset: 0 }),
      UpdateQuery.viewUpdateGroupsOnAppAsync(graphqlClient, { appId: projectId, limit, offset: 0 }),
    ]);

  return {
    project: {
      id: app.id,
      name: app.name,
      fullName: app.fullName,
      slug: app.slug,
      account: app.ownerAccount.name,
      url: getProjectDashboardUrl(app.ownerAccount.name, app.slug),
    },
    productionBuilds: productionBuilds.map(toBuildSummary),
    developmentBuilds: developmentBuilds.map(toBuildSummary),
    workflowRuns: processWorkflowRuns(workflowRuns),
    submissions: submissions.map(toSubmissionSummary),
    updates: updateGroups.map(toUpdateSummary),
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
    runtimeVersion: build.runtimeVersion ?? null,
    sdkVersion: build.sdkVersion ?? null,
    channel: build.channel ?? null,
    gitCommitHash: build.gitCommitHash ?? null,
    gitCommitMessage: build.gitCommitMessage?.split('\n')[0] ?? null,
    message: build.message ?? null,
    initiatingActor: build.initiatingActor?.displayName ?? null,
    createdAt: build.createdAt,
    completedAt: build.completedAt ?? null,
    url: getBuildLogsUrl(build),
  };
}

function toSubmissionSummary(submission: SubmissionFragment): SubmissionStatusSummary {
  return {
    id: submission.id,
    platform: submission.platform,
    status: submission.status,
    androidTrack: submission.androidConfig?.track ?? null,
    error: submission.error?.message ?? null,
  };
}

function toUpdateSummary(updateGroup: UpdateFragment[]): UpdateStatusSummary {
  const representativeUpdate = updateGroup[0];
  const platforms = [...new Set(updateGroup.map(update => update.platform))].sort().join(', ');
  return {
    group: representativeUpdate.group,
    branch: representativeUpdate.branch.name,
    message: representativeUpdate.message ?? null,
    runtimeVersion: representativeUpdate.runtimeVersion,
    platforms,
    isRollBackToEmbedded: representativeUpdate.isRollBackToEmbedded,
    gitCommitHash: representativeUpdate.gitCommitHash ?? null,
    createdAt: representativeUpdate.createdAt,
  };
}

export function printProjectStatusAsText(status: ProjectStatusSummary): void {
  Log.addNewLineIfNone();
  Log.log(chalk.bold(status.project.fullName));
  Log.log(chalk.dim(status.project.url));

  renderSection('Production builds', status.productionBuilds, renderBuild);
  renderSection('Development builds', status.developmentBuilds, renderBuild);
  renderSection('Workflow runs', status.workflowRuns, renderWorkflowRun);
  renderSection('Submissions', status.submissions, renderSubmission);
  renderSection('Updates', status.updates, renderUpdate);
}

function renderSection<T>(title: string, items: T[], renderItem: (item: T) => string): void {
  Log.newLine();
  Log.log(chalk.bold(title));
  if (items.length === 0) {
    Log.log(chalk.dim('  None'));
    return;
  }
  for (const item of items) {
    Log.log(renderItem(item));
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
  lines.push(`    ${chalk.dim(build.url)}`);
  return lines.join('\n');
}

function renderWorkflowRun(run: WorkflowRunResult): string {
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
  lines.push(`    ${chalk.dim(run.id)}`);
  return lines.join('\n');
}

function renderSubmission(submission: SubmissionStatusSummary): string {
  const lines = [
    `  ${joinMeta([
      colorSubmissionStatus(submission.status),
      appPlatformDisplayNames[submission.platform],
      submission.androidTrack ? `track: ${submission.androidTrack}` : null,
    ])}`,
  ];
  if (submission.error) {
    lines.push(`    ${chalk.red(submission.error)}`);
  }
  lines.push(`    ${chalk.dim(submission.id)}`);
  return lines.join('\n');
}

function renderUpdate(update: UpdateStatusSummary): string {
  const lines = [
    `  ${joinMeta([
      chalk.cyan(update.branch),
      update.platforms,
      `runtime: ${update.runtimeVersion}`,
      timeAgo(update.createdAt),
    ])}`,
  ];
  const message = update.isRollBackToEmbedded ? 'Roll back to embedded' : update.message;
  if (message) {
    lines.push(`    ${chalk.dim(shortHash(update.gitCommitHash))}  ${message}`);
  }
  lines.push(`    ${chalk.dim(update.group)}`);
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
