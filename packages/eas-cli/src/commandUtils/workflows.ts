import {
  WorkflowJobQuery,
  WorkflowRunByIdWithJobsQuery,
  WorkflowRunFragment,
  WorkflowRunStatus,
} from '../graphql/generated';

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

export type WorkflowRunWithJobsResult = WorkflowRunByIdWithJobsQuery['workflowRuns']['byId'] & {
  logs?: string;
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
  | WorkflowJobQuery['byId'];

export type WorkflowLogLine = { time: string; msg: string };
export type WorkflowLogs = Map<string, WorkflowLogLine[]>;

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

export async function processLogsFromJobAsync(
  job: WorkflowJobResult
): Promise<WorkflowLogs | null> {
  if (!job.turtleJobRun?.logFileUrls?.length) {
    return null;
  }
  const response = await fetch(job.turtleJobRun.logFileUrls[0], {
    method: 'GET',
  });
  const rawLogs = await response.text();
  const logs: WorkflowLogs = new Map();
  const logKeys = new Set<string>();
  rawLogs.split('\n').forEach(line => {
    try {
      const parsedLine = JSON.parse(line);
      const { buildStepDisplayName, buildStepInternalId, time, msg } = parsedLine;
      const stepId = buildStepDisplayName ?? buildStepInternalId;
      if (stepId) {
        if (!logKeys.has(stepId)) {
          logKeys.add(stepId);
          logs.set(stepId, []);
        }
        logs.get(stepId)?.push({ time, msg });
      }
    } catch {}
  });
  return logs;
}
