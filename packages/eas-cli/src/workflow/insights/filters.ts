import { Flags } from '@oclif/core';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../../commandUtils/errors';
import {
  WorkflowRunStatus,
  WorkflowRunTriggerEventType,
  WorkflowsInsightsFiltersInput,
} from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

// Insights only cover finished runs, so the other run statuses would never match.
export const INSIGHTS_RUN_STATUSES = [
  WorkflowRunStatus.Success,
  WorkflowRunStatus.Failure,
  WorkflowRunStatus.Canceled,
] as const;

export type InsightsRunStatus = (typeof INSIGHTS_RUN_STATUSES)[number];

/** The filters as the user typed them, before workflow file names are resolved to IDs. */
export interface AppliedWorkflowsInsightsFilters {
  workflows?: string[];
  statuses?: InsightsRunStatus[];
  triggerEventTypes?: WorkflowRunTriggerEventType[];
  gitRef?: string;
}

export const WorkflowsInsightsSharedFilterFlags = {
  workflow: Flags.string({
    description: 'Only include runs of this workflow file name (can be specified multiple times).',
    multiple: true,
  }),
  'git-ref': Flags.string({
    description:
      'Only include runs requested for this git ref, for example main or refs/heads/main, or for the full 40-character commit SHA that eas workflow:run recorded.',
  }),
};

export interface WorkflowsInsightsFilterFlags {
  workflow?: string[];
  status?: InsightsRunStatus[];
  trigger?: WorkflowRunTriggerEventType[];
  'git-ref'?: string;
}

/** The server filters by workflow ID, so workflow file names are resolved first. */
export async function resolveWorkflowsInsightsFiltersInputAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  flags: WorkflowsInsightsFilterFlags
): Promise<WorkflowsInsightsFiltersInput | undefined> {
  const input: WorkflowsInsightsFiltersInput = {};

  if (flags.workflow?.length) {
    input.workflowIds = await resolveWorkflowIdsAsync(graphqlClient, appId, flags.workflow);
  }
  if (flags.status?.length) {
    input.statuses = flags.status;
  }
  if (flags.trigger?.length) {
    input.triggerEventTypes = flags.trigger;
  }
  if (flags['git-ref']) {
    input.gitRefRequested = [normalizeGitRef(flags['git-ref'])];
  }

  return Object.keys(input).length === 0 ? undefined : input;
}

export function getAppliedWorkflowsInsightsFilters(
  flags: WorkflowsInsightsFilterFlags
): AppliedWorkflowsInsightsFilters | undefined {
  const applied: AppliedWorkflowsInsightsFilters = {
    ...(flags.workflow?.length ? { workflows: flags.workflow } : {}),
    ...(flags.status?.length ? { statuses: flags.status } : {}),
    ...(flags.trigger?.length ? { triggerEventTypes: flags.trigger } : {}),
    ...(flags['git-ref'] ? { gitRef: normalizeGitRef(flags['git-ref']) } : {}),
  };
  return Object.keys(applied).length === 0 ? undefined : applied;
}

export async function resolveWorkflowIdsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  fileNames: string[]
): Promise<string[]> {
  const workflows = await AppQuery.byIdWorkflowFileNamesAsync(graphqlClient, appId);
  const knownFileNames = new Set(workflows.map(workflow => workflow.fileName));
  const requestedFileNames = new Set(fileNames);
  const unknownFileNames = [...requestedFileNames].filter(
    fileName => !knownFileNames.has(fileName)
  );
  if (unknownFileNames.length > 0) {
    const quoted = unknownFileNames.map(fileName => `"${fileName}"`).join(', ');
    const known =
      knownFileNames.size > 0
        ? `Known: ${[...knownFileNames].sort().join(', ')}.`
        : 'No workflows are known yet.';
    throw new EasCommandError(
      `Workflow file(s) not found on this project: ${quoted}. ${known} --workflow takes the workflow file name including the extension; a workflow is listed after its first run.`
    );
  }
  return workflows
    .filter(workflow => requestedFileNames.has(workflow.fileName))
    .map(workflow => workflow.id);
}

/**
 * A run records either the fully qualified ref it was requested for, or the commit SHA when
 * `eas workflow:run --ref` resolved one, so only a bare branch name needs qualifying.
 */
export function normalizeGitRef(gitRef: string): string {
  if (gitRef.startsWith('refs/') || COMMIT_SHA.test(gitRef)) {
    return gitRef;
  }
  return `refs/heads/${gitRef}`;
}
