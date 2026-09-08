import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  WorkflowRunStatus,
  WorkflowRunTriggerEventType,
  WorkflowsInsightsFiltersInput,
} from '../../graphql/generated';
import { WorkflowQuery } from '../../graphql/queries/WorkflowQuery';
import { AppliedWorkflowsInsightsFilters } from './formatInsights';

export interface WorkflowsInsightsFilterFlags {
  workflow?: string[];
  status?: WorkflowRunStatus[];
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
    const workflows = await Promise.all(
      flags.workflow.map(fileName =>
        WorkflowQuery.byAppIdAndFileNameAsync(graphqlClient, { appId, fileName })
      )
    );
    input.workflowIds = workflows.map(workflow => workflow.id);
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

/** Runs record the fully qualified ref, so a bare branch name means `refs/heads/<name>`. */
export function normalizeGitRef(gitRef: string): string {
  return gitRef.startsWith('refs/') ? gitRef : `refs/heads/${gitRef}`;
}
