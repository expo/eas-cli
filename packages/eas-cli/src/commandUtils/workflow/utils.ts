import { fetchRawLogsForJobAsync } from './fetchLogs';
import {
  WorkflowJobResult,
  WorkflowLogLine,
  WorkflowLogs,
  WorkflowRunResult,
  WorkflowTriggerType,
} from './types';
import {
  WorkflowRunFragment,
  WorkflowRunStatus,
  WorkflowRunTriggerEventType,
} from '../../graphql/generated';
import { Choice } from '../../prompts';

export function computeTriggerInfoForWorkflowRun(run: WorkflowRunFragment): {
  triggerType: WorkflowTriggerType;
  trigger: string | null;
} {
  let triggerType = WorkflowTriggerType.OTHER;
  let trigger = '';
  if (run.actor?.__typename === 'Robot') {
    if (run.actor.firstName?.startsWith('GitHub App · ')) {
      trigger = `${run.requestedGitRef ?? ''}@${run.gitCommitHash?.substring(0, 12) ?? ''}`;
    }
  } else if (run.actor?.__typename === 'User') {
    trigger = run.actor.username;
  }
  switch (run.triggerEventType) {
    case WorkflowRunTriggerEventType.Manual:
      triggerType = WorkflowTriggerType.MANUAL;
      break;
    case WorkflowRunTriggerEventType.GithubPullRequestLabeled:
    case WorkflowRunTriggerEventType.GithubPullRequestOpened:
    case WorkflowRunTriggerEventType.GithubPullRequestReopened:
    case WorkflowRunTriggerEventType.GithubPullRequestSynchronize:
    case WorkflowRunTriggerEventType.GithubPush:
      triggerType = WorkflowTriggerType.GITHUB;
      break;
    case WorkflowRunTriggerEventType.Schedule:
      triggerType = WorkflowTriggerType.SCHEDULED;
      trigger = run.triggeringSchedule ?? '';
      break;
  }
  return { triggerType, trigger };
}

export function choiceFromWorkflowRun(run: WorkflowRunResult): Choice {
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

export function choiceFromWorkflowJob(job: WorkflowJobResult, index: number): Choice {
  return {
    title: `${job.name} - ${job.status}`,
    value: index,
    description: `ID: ${job.id}`,
  };
}

export function choicesFromWorkflowLogs(logs: WorkflowLogs): Choice[] {
  return Array.from(logs.keys()).map(step => {
    const logLines = logs.get(step);
    const stepStatus =
      logLines?.filter((line: WorkflowLogLine) => line.marker === 'end-step')[0]?.result ?? '';
    return {
      title: `${step} - ${stepStatus}`,
      value: step,
    };
  });
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
  const rawLogs = await fetchRawLogsForJobAsync(job);
  if (!rawLogs) {
    return null;
  }
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
