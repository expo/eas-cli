import chalk from 'chalk';
import * as fs from 'node:fs';

import { fetchAndProcessLogsFromJobAsync } from './logs/parseLogs';
import {
  WorkflowJobResult,
  WorkflowLogLine,
  WorkflowLogs,
  WorkflowRunResult,
  WorkflowTriggerType,
} from './types';
import {
  WorkflowJobStatus,
  WorkflowRunByIdQuery,
  WorkflowRunByIdWithJobsQuery,
  WorkflowRunFragment,
  WorkflowRunStatus,
  WorkflowRunTriggerEventType,
} from '../../graphql/generated';
import { WorkflowRunLogsWatcher } from './logs/watcher';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log from '../../log';
import { ora, updateSpinnerText } from '../../ora';
import { Choice } from '../../prompts';
import formatFields from '../../utils/formatFields';
import { createRealtimeLogsClient } from '../../utils/centrifuge';
import { sleepAsync } from '../../utils/promise';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';
import nullthrows from 'nullthrows';

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
  return Array.from(logs.values())
    .map(({ key, label, logLines }) => {
      const stepStatus =
        logLines?.filter(
          (line: WorkflowLogLine) => line.marker === 'end-step' || line.marker === 'END_PHASE'
        )[0]?.result ?? '';
      return {
        title: `${label} - ${stepStatus}`,
        name: label,
        status: stepStatus,
        value: key,
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

type WorkflowRunWithJobs = WorkflowRunByIdWithJobsQuery['workflowRuns']['byId'];

type JobWithLogs = {
  job: WorkflowRunWithJobs['jobs'][number];
  logs: WorkflowLogs;
};

function stepLogTail(
  step: { logLines?: WorkflowLogLine[] },
  maxLogLines: number // -1 means no limit
): string[] {
  const messages = step.logLines?.map(line => line.msg) ?? [];
  return maxLogLines === -1 ? messages : messages.slice(-maxLogLines);
}

export async function logsForFailedWorkflowRunAsync(
  graphqlClient: ExpoGraphqlClient,
  workflowRun: WorkflowRunWithJobs
): Promise<JobWithLogs[]> {
  const jobs = workflowRun.jobs.filter(job => job.status === WorkflowJobStatus.Failure);
  return await Promise.all(
    jobs.map(async job => {
      const maybeLogs = await fetchAndProcessLogsFromJobAsync({ graphqlClient }, job);
      return { job, logs: maybeLogs ?? new Map() };
    })
  );
}

export function formatActiveWorkflowRun(
  jobLogs: JobWithLogs[],
  maxLogLines: number = 5 // -1 means no limit
): string {
  const statusValues = [];

  for (const { job, logs } of jobLogs) {
    statusValues.push({ label: '', value: '' });
    statusValues.push({ label: '  Job', value: job.name });
    statusValues.push({ label: '  Status', value: descriptionForJobStatus(job.status) });
    if (job.status !== WorkflowJobStatus.InProgress) {
      continue;
    }
    const steps = choicesFromWorkflowLogs(logs);
    if (steps.length === 0) {
      continue;
    }
    const currentStep = steps[steps.length - 1];
    statusValues.push({ label: '  Current step', value: currentStep.name });
    if (currentStep.logLines?.length) {
      statusValues.push({ label: '  Current logs', value: '' });
      for (const log of stepLogTail(currentStep, maxLogLines)) {
        statusValues.push({ label: '', value: log });
      }
    }
  }

  statusValues.push({ label: '', value: '' });
  return formatFields(statusValues);
}

export function formatFailedWorkflowRun(
  jobLogs: JobWithLogs[],
  maxLogLines: number = -1 // -1 means no limit
): string {
  const statusValues = [];

  for (const { job, logs } of jobLogs) {
    statusValues.push({ label: '', value: '' });
    statusValues.push({ label: '  Failed job', value: job.name });
    const steps = choicesFromWorkflowLogs(logs);
    const failedStep = steps.find(step => step.status === 'fail' || step.status === 'failed');
    if (!failedStep) {
      continue;
    }
    statusValues.push({ label: '  Failed step', value: failedStep.name });
    statusValues.push({ label: '  Logs for failed step', value: '' });
    for (const log of stepLogTail(failedStep, maxLogLines)) {
      statusValues.push({ label: '', value: log });
    }
  }

  statusValues.push({ label: '', value: '' });
  return formatFields(statusValues);
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
export async function showWorkflowStatusAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    workflowRunId,
    spinnerUsesStdErr,
    waitForCompletion = true,
  }: { workflowRunId: string; spinnerUsesStdErr: boolean; waitForCompletion?: boolean }
): Promise<WorkflowRunByIdQuery['workflowRuns']['byId']> {
  Log.log('Waiting for workflow run to complete. You can press Ctrl+C to exit.');

  const spinner = ora({
    stream: spinnerUsesStdErr ? process.stderr : process.stdout,
    text: '',
  }).start();
  updateSpinnerText(spinner, {
    prefixText: chalk`{bold.yellow Workflow run is waiting to start:}`,
  });

  const watcher = new WorkflowRunLogsWatcher(
    graphqlClient,
    () => createRealtimeLogsClient(graphqlClient),
    () => {
      renderActiveWorkflowRun();
    }
  );
  let failedFetchesCount = 0;
  let renderActiveWorkflowRun = (): void => {};

  try {
    while (true) {
      try {
        const workflowRun = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, workflowRunId, {
          useCache: false,
        });

        failedFetchesCount = 0;

        switch (workflowRun.status) {
          case WorkflowRunStatus.New:
            break;
          case WorkflowRunStatus.InProgress: {
            updateSpinnerText(spinner, {
              prefixText: chalk`{bold.green Workflow run is in progress:}`,
            });
            const logsStates = await watcher.syncJobsAsync(workflowRun.jobs);
            renderActiveWorkflowRun = () => {
              const text = formatActiveWorkflowRun(
                workflowRun.jobs.map(job => ({
                  job,
                  logs: nullthrows(
                    logsStates.get(job.id),
                    'syncJobsAsync must have been called before getLogs'
                  ).getLogs({
                    isCompleted: job.status !== WorkflowJobStatus.InProgress,
                  }),
                })),
                5
              );
              updateSpinnerText(spinner, { text });
            };
            renderActiveWorkflowRun();
            break;
          }
          case WorkflowRunStatus.ActionRequired:
            updateSpinnerText(spinner, {
              prefixText: chalk`{bold.yellow Workflow run is waiting for action:}`,
            });
            break;

          case WorkflowRunStatus.Canceled:
            updateSpinnerText(spinner, {
              prefixText: chalk`{bold.yellow Workflow has been canceled.}`,
            });
            spinner.stopAndPersist();
            return workflowRun;

          case WorkflowRunStatus.Failure: {
            updateSpinnerText(spinner, {
              prefixText: chalk`{bold.red Workflow has failed.}`,
            });
            const jobLogs = await logsForFailedWorkflowRunAsync(graphqlClient, workflowRun);
            spinner.fail(formatFailedWorkflowRun(jobLogs, 30));
            return workflowRun;
          }
          case WorkflowRunStatus.Success:
            updateSpinnerText(spinner, {
              prefixText: chalk`{bold.green Workflow has completed successfully.}`,
            });
            spinner.succeed('');
            return workflowRun;
        }
        if (!waitForCompletion) {
          if (spinner.isSpinning) {
            spinner.stopAndPersist();
          }
          return workflowRun;
        }
      } catch {
        updateSpinnerText(spinner, {
          text: '⚠ Failed to fetch the workflow run status. Check your network connection.',
        });

        failedFetchesCount += 1;

        if (failedFetchesCount > 6) {
          spinner.fail('Failed to fetch the workflow run status 6 times in a row. Aborting wait.');
          process.exit(workflowRunExitCodes.WAIT_ABORTED);
        }
      }

      await sleepAsync(10 /* seconds */ * 1000 /* milliseconds */);
    }
  } finally {
    watcher.close();
  }
}

export const workflowRunExitCodes = {
  WORKFLOW_FAILED: 11,
  WORKFLOW_CANCELED: 12,
  WAIT_ABORTED: 13,
};
