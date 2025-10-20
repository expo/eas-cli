import * as fs from 'node:fs';

import { fetchRawLogsForBuildJobAsync, fetchRawLogsForCustomJobAsync } from './fetchLogs';
import {
  WorkflowJobResult,
  WorkflowLogLine,
  WorkflowLogs,
  WorkflowRunResult,
  WorkflowTriggerType,
} from './types';
import {
  WorkflowJobStatus,
  WorkflowJobType,
  WorkflowRunByIdWithJobsQuery,
  WorkflowRunFragment,
  WorkflowRunStatus,
  WorkflowRunTriggerEventType,
} from '../../graphql/generated';
import Log from '../../log';
import { Choice } from '../../prompts';
import formatFields from '../../utils/formatFields';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

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

export function choicesFromWorkflowLogs(
  logs: WorkflowLogs
): (Choice & { name: string; status: string; logLines: WorkflowLogLine[] | undefined })[] {
  return Array.from(logs.keys())
    .map(step => {
      const logLines = logs.get(step);
      const stepStatus =
        logLines?.filter((line: WorkflowLogLine) => line.marker === 'end-step')[0]?.result ?? '';
      return {
        title: `${step} - ${stepStatus}`,
        name: step,
        status: stepStatus,
        value: step,
        logLines,
      };
    })
    .filter(step => step.status !== 'skipped');
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

export async function fetchAndProcessLogsFromJobAsync(
  state: { graphqlClient: ExpoGraphqlClient },
  job: WorkflowJobResult
): Promise<WorkflowLogs | null> {
  let rawLogs: string | null;
  switch (job.type) {
    case WorkflowJobType.Build:
    case WorkflowJobType.Repack:
      rawLogs = await fetchRawLogsForBuildJobAsync(state, job);
      break;
    default:
      rawLogs = await fetchRawLogsForCustomJobAsync(job);
      break;
  }
  if (!rawLogs) {
    return null;
  }
  Log.debug(`rawLogs = ${JSON.stringify(rawLogs, null, 2)}`);
  const logs: WorkflowLogs = new Map();
  const logKeys = new Set<string>();
  rawLogs.split('\n').forEach((line, index) => {
    Log.debug(`line ${index} = ${JSON.stringify(line, null, 2)}`);
    try {
      const parsedLine = JSON.parse(line);
      const { buildStepDisplayName, buildStepInternalId, time, msg, result, marker, err } =
        parsedLine;
      const stepId = buildStepDisplayName ?? buildStepInternalId;
      if (stepId) {
        if (!logKeys.has(stepId)) {
          logKeys.add(stepId);
          logs.set(stepId, []);
        }
        logs.get(stepId)?.push({ time, msg, result, marker, err });
      }
    } catch {}
  });
  return logs;
}

function descriptionForJobStatus(status: WorkflowJobStatus): string {
  switch (status) {
    case WorkflowJobStatus.New:
      return 'Waiting for worker';
    case WorkflowJobStatus.InProgress:
      return 'In progress';
    case WorkflowJobStatus.Success:
      return 'Completed successfully';
    case WorkflowJobStatus.Failure:
      return 'Failed';
    case WorkflowJobStatus.Canceled:
      return 'Canceled';
    case WorkflowJobStatus.Skipped:
      return 'Skipped';
    case WorkflowJobStatus.ActionRequired:
      return 'Waiting for action';
    case WorkflowJobStatus.PendingCancel:
      return 'Pending cancel';
  }
}

export async function infoForActiveWorkflowRunAsync(
  graphqlClient: ExpoGraphqlClient,
  workflowRun: WorkflowRunByIdWithJobsQuery['workflowRuns']['byId'],
  maxLogLines: number = 5 // -1 means no limit
): Promise<string> {
  const statusLines = [];
  const statusValues = [];
  for (const job of workflowRun.jobs) {
    statusValues.push({ label: '', value: '' });
    statusValues.push({ label: '  Job', value: job.name });
    statusValues.push({ label: '  Status', value: descriptionForJobStatus(job.status) });
    if (job.status !== WorkflowJobStatus.InProgress) {
      continue;
    }
    const logs = await fetchAndProcessLogsFromJobAsync({ graphqlClient }, job);
    const steps = logs ? choicesFromWorkflowLogs(logs) : [];
    if (steps.length > 0) {
      const currentStep = steps[steps.length - 1];
      statusValues.push({ label: '  Current step', value: currentStep.name });
      if (currentStep?.logLines?.length) {
        statusValues.push({ label: '  Current logs', value: '' });
        const currentLogs =
          currentStep.logLines
            ?.map(line => line.msg)
            .filter((_, index) => {
              if (maxLogLines === -1) {
                return true;
              }
              return index > (currentStep.logLines?.length ?? 0) - maxLogLines;
            }) ?? [];
        for (const log of currentLogs) {
          statusValues.push({ label: '', value: log });
        }
      }
    }
  }
  statusValues.push({ label: '', value: '' });
  statusLines.push(formatFields(statusValues));
  return statusLines.join('\n');
}

export async function infoForFailedWorkflowRunAsync(
  graphqlClient: ExpoGraphqlClient,
  workflowRun: WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']
): Promise<string> {
  const statusLines = [];
  const statusValues = [];
  for (const job of workflowRun.jobs) {
    if (job.status !== WorkflowJobStatus.Failure) {
      continue;
    }
    const logs = await fetchAndProcessLogsFromJobAsync({ graphqlClient }, job);
    const steps = logs ? choicesFromWorkflowLogs(logs) : [];
    statusValues.push({ label: '', value: '' });
    statusValues.push({ label: '  Failed job', value: job.name });
    if (steps.length > 0) {
      const failedStep = steps.find(step => step.status === 'fail');
      if (failedStep) {
        const logs = failedStep.logLines?.map(line => line.msg) ?? [];
        statusValues.push({ label: '  Failed step', value: failedStep.name });
        statusValues.push({
          label: '  Logs for failed step',
          value: '',
        });
        for (const log of logs) {
          statusValues.push({ label: '', value: log });
        }
      }
    }
  }
  statusValues.push({ label: '', value: '' });
  statusLines.push(formatFields(statusValues));
  return statusLines.join('\n');
}
export async function fileExistsAsync(filePath: string): Promise<boolean> {
  return await fs.promises
    .access(filePath, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
}
export async function maybeReadStdinAsync(): Promise<string | null> {
  // Check if there's data on stdin
  if (process.stdin.isTTY) {
    return null;
  }

  return await new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      const trimmedData = data.trim();
      resolve(trimmedData || null);
    });

    process.stdin.on('error', err => {
      reject(err);
    });
  });
}
