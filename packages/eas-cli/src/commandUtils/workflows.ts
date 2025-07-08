import { ExpoGraphqlClient } from './context/contextUtils/createGraphqlClient';
import {
  WorkflowJobQuery,
  WorkflowRunByIdWithJobsQuery,
  WorkflowRunFragment,
  WorkflowRunStatus,
} from '../graphql/generated';
import { AppQuery } from '../graphql/queries/AppQuery';
import { promptAsync } from '../prompts';

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

export type WorkflowLogLine = { time: string; msg: string; result?: string; marker?: string };
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
      const { result, marker } = parsedLine;
      const { buildStepDisplayName, buildStepInternalId, time, msg } = parsedLine;
      const stepId = buildStepDisplayName ?? buildStepInternalId;
      if (stepId) {
        if (!logKeys.has(stepId)) {
          logKeys.add(stepId);
          logs.set(stepId, []);
        }
        logs.get(stepId)?.push({ time, msg, result, marker });
      }
    } catch {}
  });
  return logs;
}

export async function selectWorkflowRunIfNeededAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  idToQuery?: string
): Promise<string> {
  if (idToQuery) {
    return idToQuery ?? '';
  }
  const runs = await AppQuery.byIdWorkflowRunsFilteredByStatusAsync(
    graphqlClient,
    projectId,
    undefined,
    20
  );
  const selectedId = (
    await promptAsync({
      type: 'select',
      name: 'selectedRun',
      message: 'Select a workflow run:',
      choices: runs.map(run => {
        const titleArray = [run.id, run.workflow.fileName, run.status, run.createdAt];
        if (run.gitCommitMessage?.length) {
          titleArray.push(run.gitCommitMessage?.split('\n')[0] ?? '');
        }
        return {
          title: titleArray.join(' - '),
          value: run.id,
        };
      }),
    })
  ).selectedRun;
  return selectedId;
}
