import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  WorkflowDeviceTestCaseHistoryFiltersInput,
  WorkflowDeviceTestCaseInsightsFiltersInput,
  WorkflowDeviceTestCaseStatusFilter,
} from '../../graphql/generated';
import { normalizeGitRef, resolveWorkflowIdsAsync } from './filters';

/** Statuses as the dashboard names them; `PASSED` means passed on the first attempt. */
export const MAESTRO_STATUS_OPTIONS = ['PASSED', 'FLAKY', 'FAILED'] as const;
export type MaestroStatusOption = (typeof MAESTRO_STATUS_OPTIONS)[number];

const STATUS_FILTER_BY_OPTION: Record<MaestroStatusOption, WorkflowDeviceTestCaseStatusFilter> = {
  PASSED: WorkflowDeviceTestCaseStatusFilter.PassedClean,
  FLAKY: WorkflowDeviceTestCaseStatusFilter.Flaky,
  FAILED: WorkflowDeviceTestCaseStatusFilter.Failed,
};

export interface MaestroInsightsFilterFlags {
  workflow?: string[];
  status?: MaestroStatusOption[];
  tag?: string[];
  search?: string;
  'git-ref'?: string;
}

/** The filters as the user typed them, before workflow file names are resolved to IDs. */
export interface AppliedMaestroInsightsFilters {
  workflows?: string[];
  statuses?: MaestroStatusOption[];
  tags?: string[];
  search?: string;
  gitRef?: string;
}

export async function resolveMaestroHistoryFiltersInputAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  flags: Pick<MaestroInsightsFilterFlags, 'workflow' | 'git-ref'>
): Promise<WorkflowDeviceTestCaseHistoryFiltersInput | undefined> {
  const input: WorkflowDeviceTestCaseHistoryFiltersInput = {};
  if (flags.workflow?.length) {
    input.workflowIds = await resolveWorkflowIdsAsync(graphqlClient, appId, flags.workflow);
  }
  if (flags['git-ref']) {
    input.gitRefs = [normalizeGitRef(flags['git-ref'])];
  }
  return Object.keys(input).length === 0 ? undefined : input;
}

export async function resolveMaestroInsightsFiltersInputAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  flags: MaestroInsightsFilterFlags
): Promise<WorkflowDeviceTestCaseInsightsFiltersInput | undefined> {
  const input: WorkflowDeviceTestCaseInsightsFiltersInput = {
    ...(await resolveMaestroHistoryFiltersInputAsync(graphqlClient, appId, flags)),
  };
  if (flags.status?.length) {
    input.statuses = flags.status.map(status => STATUS_FILTER_BY_OPTION[status]);
  }
  if (flags.tag?.length) {
    input.tags = flags.tag;
  }
  return Object.keys(input).length === 0 ? undefined : input;
}

export function getAppliedMaestroInsightsFilters(
  flags: MaestroInsightsFilterFlags
): AppliedMaestroInsightsFilters | undefined {
  const applied: AppliedMaestroInsightsFilters = {
    ...(flags.workflow?.length ? { workflows: flags.workflow } : {}),
    ...(flags.status?.length ? { statuses: flags.status } : {}),
    ...(flags.tag?.length ? { tags: flags.tag } : {}),
    ...(flags.search ? { search: flags.search } : {}),
    ...(flags['git-ref'] ? { gitRef: normalizeGitRef(flags['git-ref']) } : {}),
  };
  return Object.keys(applied).length === 0 ? undefined : applied;
}
