import { WorkflowRunFragment, WorkflowRunStatus } from '../graphql/generated';

export type WorkflowRunResult = {
  id: string;
  status: string;
  gitCommitMessage: string | null;
  gitCommitHash: string | null;
  startedAt: string;
  finishedAt: string;
  workflowId: string;
  workflowName: string | null;
  workflowFileName: string;
};

export function processWorkflowRuns(runs: WorkflowRunFragment[]): WorkflowRunResult[] {
  return runs.map(run => {
    const finishedAt = run.status === WorkflowRunStatus.InProgress ? null : run.updatedAt;
    return {
      id: run.id,
      status: run.status,
      gitCommitMessage: run.gitCommitMessage?.split('\n')[0] ?? null,
      gitCommitHash: run.gitCommitHash ?? null,
      startedAt: run.createdAt,
      finishedAt,
      workflowId: run.workflow.id,
      workflowName: run.workflow.name ?? null,
      workflowFileName: run.workflow.fileName,
    };
  });
}
export type WorkflowResult = {
  id: string;
  name?: string | null | undefined;
  fileName: string;
  createdAt: string;
  updatedAt: string;
};
