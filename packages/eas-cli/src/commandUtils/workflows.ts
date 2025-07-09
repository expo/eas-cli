import { ExpoGraphqlClient } from './context/contextUtils/createGraphqlClient';
import {
  WorkflowJobByIdQuery,
  WorkflowRunByIdWithJobsQuery,
  WorkflowRunFragment,
  WorkflowRunStatus,
} from '../graphql/generated';
import { AppQuery } from '../graphql/queries/AppQuery';
import { WorkflowJobQuery } from '../graphql/queries/WorkflowJobQuery';
import { WorkflowRunQuery } from '../graphql/queries/WorkflowRunQuery';
import { Choice, promptAsync } from '../prompts';

export enum WorkflowTriggerType {
  MANUAL = 'Manual',
  GITHUB = 'GitHub',
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

export enum WorkflowCommandSelectionState {
  START = 'START',
  WORKFLOW_RUN_SELECTION = 'WORKFLOW_RUN_SELECTION',
  WORKFLOW_JOB_SELECTION = 'WORKFLOW_JOB_SELECTION',
  WORKFLOW_STEP_SELECTION = 'WORKFLOW_STEP_SELECTION',
  FINISH = 'FINISH',
  ERROR = 'ERROR',
}

export type WorkflowCommandSelectionContext = {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  state: WorkflowCommandSelectionState;
  runId?: string;
  jobId?: string;
  step?: string;
  job?: WorkflowJobResult;
  logs?: WorkflowLogs;
  message?: string;
};

export type WorkflowCommandSelectionAction = (
  input: WorkflowCommandSelectionContext
) => Promise<WorkflowCommandSelectionContext>;

export function computeTriggerInfoForWorkflowRun(run: WorkflowRunFragment): {
  triggerType: WorkflowTriggerType;
  trigger: string | null;
} {
  let triggerType = WorkflowTriggerType.OTHER;
  let trigger = '';
  if (run.actor?.__typename === 'Robot') {
    if (run.actor.firstName?.startsWith('GitHub App · ')) {
      triggerType = WorkflowTriggerType.GITHUB;
      trigger = `${run.requestedGitRef ?? ''}@${run.gitCommitHash?.substring(0, 12) ?? ''}`;
    }
  } else if (run.actor?.__typename === 'User') {
    triggerType = WorkflowTriggerType.MANUAL;
    trigger = run.actor.username;
  }
  return { triggerType, trigger };
}

export function computePromptInfoForWorkflowRunSelection(run: WorkflowRunResult): Choice {
  const titleArray = [
    run.workflowFileName,
    run.status,
    run.startedAt,
    run.triggerType,
    run.trigger,
  ];
  return {
    title: titleArray.join(' - '),
    value: run.id,
    description: `ID: ${run.id}, Message: ${run.gitCommitMessage?.split('\n')[0] ?? ''}`,
  };
}

export function processWorkflowRuns(runs: WorkflowRunFragment[]): WorkflowRunResult[] {
  return runs.map(run => {
    const finishedAt = run.status === WorkflowRunStatus.InProgress ? null : run.updatedAt;
    const { triggerType, trigger } = computeTriggerInfoForWorkflowRun(run);
    return {
      id: run.id,
      status: run.status,
      gitCommitMessage: run.gitCommitMessage?.split('\n')[0] ?? null,
      gitCommitHash: run.gitCommitHash ?? null,
      startedAt: run.createdAt,
      finishedAt,
      triggerType,
      trigger,
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

// eslint-disable-next-line async-protect/async-suffix
export const workflowRunSelectionAction: WorkflowCommandSelectionAction = async input => {
  const { graphqlClient, projectId, ...params } = input;
  if (params.runId) {
    return {
      ...input,
      state: WorkflowCommandSelectionState.WORKFLOW_JOB_SELECTION,
      runId: params.runId,
    };
  }
  const runs = await AppQuery.byIdWorkflowRunsFilteredByStatusAsync(
    graphqlClient,
    projectId,
    undefined,
    20
  );
  if (runs.length === 0) {
    return {
      ...input,
      state: WorkflowCommandSelectionState.ERROR,
      message: 'No workflow runs found',
    };
  }
  const processedRuns = processWorkflowRuns(runs);
  const choices = processedRuns.map(run => computePromptInfoForWorkflowRunSelection(run));
  const selectedId = (
    await promptAsync({
      type: 'select',
      name: 'selectedRun',
      message: 'Select a workflow run:',
      choices,
    })
  ).selectedRun;
  return {
    ...input,
    state: WorkflowCommandSelectionState.WORKFLOW_JOB_SELECTION,
    runId: selectedId,
  };
};

// eslint-disable-next-line async-protect/async-suffix
export const workflowJobSelectionAction: WorkflowCommandSelectionAction = async input => {
  const { graphqlClient, projectId, ...params } = input;
  if (params.jobId) {
    let workflowJobResult = undefined;
    try {
      workflowJobResult = await WorkflowJobQuery.byIdAsync(graphqlClient, params.jobId, {
        useCache: false,
      });
    } catch {
      return {
        ...input,
        state: WorkflowCommandSelectionState.ERROR,
        message: 'No workflow job found that matched the provided ID',
      };
    }
    return {
      ...input,
      state: WorkflowCommandSelectionState.WORKFLOW_STEP_SELECTION,
      job: workflowJobResult,
    };
  }
  if (!params.runId) {
    return {
      ...input,
      state: WorkflowCommandSelectionState.ERROR,
      message: 'No workflow run ID or job ID provided',
    };
  }
  const workflowRunResult = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, params.runId, {
    useCache: false,
  });
  if (!workflowRunResult) {
    return {
      ...input,
      state: WorkflowCommandSelectionState.ERROR,
      message: 'No workflow run found that matched the provided ID',
    };
  }
  const choices: Choice[] = workflowRunResult.jobs.map((job, i) => ({
    title: `${job.name} - ${job.status}`,
    value: i,
    description: `ID: ${job.id}`,
  }));
  choices.push({
    title: 'Go back',
    value: -1,
  });
  const selectedJobIndex = (
    await promptAsync({
      type: 'select',
      name: 'selectedJob',
      message: 'Select a job:',
      choices,
    })
  ).selectedJob;
  if (selectedJobIndex === -1) {
    return {
      ...input,
      state: WorkflowCommandSelectionState.WORKFLOW_RUN_SELECTION,
      runId: undefined,
      jobId: undefined,
    };
  }
  const selectedJob = workflowRunResult.jobs[selectedJobIndex] as WorkflowJobResult;
  return {
    ...input,
    state: WorkflowCommandSelectionState.WORKFLOW_STEP_SELECTION,
    job: selectedJob,
  };
};

// eslint-disable-next-line async-protect/async-suffix
export const workflowStepSelectionAction: WorkflowCommandSelectionAction = async input => {
  const logs = input.logs;
  if (!logs) {
    return {
      ...input,
      state: WorkflowCommandSelectionState.ERROR,
      message: 'No logs found',
    };
  }
  const choices: Choice[] = Array.from(logs.keys()).map(step => {
    const logLines = logs.get(step);
    const stepStatus =
      logLines?.filter((line: WorkflowLogLine) => line.marker === 'end-step')[0]?.result ?? '';
    return {
      title: `${step} - ${stepStatus}`,
      value: step,
    };
  });
  choices.push({
    title: 'Go back',
    value: 'go-back',
  });
  const selectedStep: string =
    (
      await promptAsync({
        type: 'select',
        name: 'selectedStep',
        message: 'Select a step:',
        choices,
      })
    ).selectedStep ?? '';
  if (selectedStep === 'go-back') {
    return {
      ...input,
      state: WorkflowCommandSelectionState.WORKFLOW_JOB_SELECTION,
      runId: input.job?.workflowRun.id,
      jobId: undefined,
    };
  }
  return {
    ...input,
    state: WorkflowCommandSelectionState.FINISH,
    step: selectedStep,
  };
};
