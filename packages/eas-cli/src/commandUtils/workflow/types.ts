import { WorkflowJobByIdQuery, WorkflowRunByIdWithJobsQuery } from '../../graphql/generated';

/*
 * Utility types for workflow commands
 */

export enum WorkflowTriggerType {
  MANUAL = 'Manual',
  GITHUB = 'GitHub',
  SCHEDULED = 'Scheduled',
  OTHER = 'Other',
}

export type WorkflowRunResult = {
  id: string;
  status: string;
  gitCommitMessage: string | null;
  gitCommitHash: string | null;
  triggerType: WorkflowTriggerType;
  trigger: string | null;
  startedAt: string;
  finishedAt: string;
  workflowId: string;
  workflowName: string | null;
  workflowFileName: string;
};

export type WorkflowResult = {
  id: string;
  name?: string | null | undefined;
  fileName: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowJobResult =
  | WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']['jobs'][number]
  | WorkflowJobByIdQuery['workflowJobs']['byId'];

export type WorkflowRunWithJobsResult = WorkflowRunResult & {
  jobs: WorkflowJobResult[];
  logs?: string;
};

export type WorkflowLogLine = { time: string; msg: string; result?: string; marker?: string };
export type WorkflowLogs = Map<string, WorkflowLogLine[]>;
