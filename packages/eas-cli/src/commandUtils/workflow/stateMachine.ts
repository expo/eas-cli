import { Choice } from 'prompts';

import { WorkflowJobResult, WorkflowLogs } from './types';
import {
  choiceFromWorkflowJob,
  choiceFromWorkflowRun,
  choicesFromWorkflowLogs,
  fetchAndProcessLogsFromJobAsync,
  processWorkflowRuns,
} from './utils';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { WorkflowJobQuery } from '../../graphql/queries/WorkflowJobQuery';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

/*
 * State machine types and functions for moving between different workflow command states
 */

export enum WorkflowCommandSelectionStateValue {
  WORKFLOW_RUN_SELECTION = 'WORKFLOW_RUN_SELECTION',
  WORKFLOW_JOB_SELECTION = 'WORKFLOW_JOB_SELECTION',
  WORKFLOW_STEP_SELECTION = 'WORKFLOW_STEP_SELECTION',
  FINISH = 'FINISH',
  ERROR = 'ERROR',
}
const workflowCommandSelectionAllowedStateTransitions: {
  [key in WorkflowCommandSelectionStateValue]: WorkflowCommandSelectionStateValue[];
} = {
  WORKFLOW_JOB_SELECTION: [
    WorkflowCommandSelectionStateValue.WORKFLOW_STEP_SELECTION,
    WorkflowCommandSelectionStateValue.WORKFLOW_RUN_SELECTION,
    WorkflowCommandSelectionStateValue.ERROR,
    WorkflowCommandSelectionStateValue.FINISH,
  ],
  WORKFLOW_RUN_SELECTION: [
    WorkflowCommandSelectionStateValue.WORKFLOW_JOB_SELECTION,
    WorkflowCommandSelectionStateValue.ERROR,
  ],
  WORKFLOW_STEP_SELECTION: [
    WorkflowCommandSelectionStateValue.WORKFLOW_JOB_SELECTION,
    WorkflowCommandSelectionStateValue.ERROR,
    WorkflowCommandSelectionStateValue.FINISH,
  ],
  ERROR: [WorkflowCommandSelectionStateValue.WORKFLOW_RUN_SELECTION],
  FINISH: [],
};

export type WorkflowCommandSelectionState = {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  nonInteractive: boolean;
  allSteps: boolean;
  state: WorkflowCommandSelectionStateValue;
  runId?: string;
  jobId?: string;
  step?: string;
  job?: WorkflowJobResult;
  logs?: WorkflowLogs | null;
  message?: string;
};

export type WorkflowCommandSelectionStateParameters = Omit<
  WorkflowCommandSelectionState,
  'graphqlClient' | 'projectId' | 'state' | 'nonInteractive' | 'allSteps'
>;

export type WorkflowCommandSelectionAction = (
  prevState: WorkflowCommandSelectionState
) => Promise<WorkflowCommandSelectionState>;

export function moveToNewWorkflowCommandSelectionState(
  previousState: WorkflowCommandSelectionState,
  newStateValue: WorkflowCommandSelectionStateValue,
  parameters: WorkflowCommandSelectionStateParameters
): WorkflowCommandSelectionState {
  if (
    !workflowCommandSelectionAllowedStateTransitions[previousState.state].includes(newStateValue)
  ) {
    const errorMessage = `Invalid state transition from ${
      previousState.state
    } to ${newStateValue}. Allowed transitions from ${
      previousState.state
    }: ${workflowCommandSelectionAllowedStateTransitions[previousState.state].join(', ')}`;
    throw new Error(errorMessage);
  }
  return {
    ...previousState,
    state: newStateValue,
    ...parameters,
  };
}

export function moveToWorkflowRunSelectionState(
  previousState: WorkflowCommandSelectionState,
  params?: {
    runId?: string | undefined;
  }
): WorkflowCommandSelectionState {
  return moveToNewWorkflowCommandSelectionState(
    previousState,
    WorkflowCommandSelectionStateValue.WORKFLOW_RUN_SELECTION,
    {
      runId: params?.runId,
      jobId: undefined,
    }
  );
}

export function moveToWorkflowJobSelectionState(
  previousState: WorkflowCommandSelectionState,
  params: {
    jobId?: string | undefined;
    runId?: string | undefined;
  }
): WorkflowCommandSelectionState {
  return moveToNewWorkflowCommandSelectionState(
    previousState,
    WorkflowCommandSelectionStateValue.WORKFLOW_JOB_SELECTION,
    params
  );
}

export function moveToWorkflowStepSelectionState(
  previousState: WorkflowCommandSelectionState,
  params: {
    job: WorkflowJobResult;
  }
): WorkflowCommandSelectionState {
  return moveToNewWorkflowCommandSelectionState(
    previousState,
    WorkflowCommandSelectionStateValue.WORKFLOW_STEP_SELECTION,
    params
  );
}

export function moveToWorkflowSelectionFinishedState(
  previousState: WorkflowCommandSelectionState,
  params: {
    step: string;
    logs: WorkflowLogs;
  }
): WorkflowCommandSelectionState {
  return moveToNewWorkflowCommandSelectionState(
    previousState,
    WorkflowCommandSelectionStateValue.FINISH,
    params
  );
}

export function moveToWorkflowSelectionErrorState(
  previousState: WorkflowCommandSelectionState,
  message: string
): WorkflowCommandSelectionState {
  return moveToNewWorkflowCommandSelectionState(
    previousState,
    WorkflowCommandSelectionStateValue.ERROR,
    {
      message,
    }
  );
}

// eslint-disable-next-line async-protect/async-suffix
export const workflowRunSelectionAction: WorkflowCommandSelectionAction = async prevState => {
  const { graphqlClient, projectId, runId, jobId, allSteps } = prevState;
  Log.debug(
    `workflowRunSelectionAction: runId = ${runId}, jobId = ${jobId}, allSteps = ${allSteps}`
  );

  if (runId) {
    return moveToWorkflowJobSelectionState(prevState, { runId });
  }
  const runs = await AppQuery.byIdWorkflowRunsFilteredByStatusAsync(
    graphqlClient,
    projectId,
    undefined,
    20
  );
  if (runs.length === 0) {
    return moveToWorkflowSelectionErrorState(prevState, 'No workflow runs found');
  }
  const processedRuns = processWorkflowRuns(runs);
  const choices = processedRuns.map(run => choiceFromWorkflowRun(run));
  const selectedId = (
    await promptAsync({
      type: 'select',
      name: 'selectedRun',
      message: 'Select a workflow run:',
      choices,
    })
  ).selectedRun;
  return moveToWorkflowJobSelectionState(prevState, { runId: selectedId });
};

// eslint-disable-next-line async-protect/async-suffix
export const workflowJobSelectionAction: WorkflowCommandSelectionAction = async prevState => {
  const { graphqlClient, runId, jobId, nonInteractive, allSteps } = prevState;
  Log.debug(
    `workflowJobSelectionAction: runId = ${runId}, jobId = ${jobId}, allSteps = ${allSteps}`
  );
  if (jobId) {
    let workflowJobResult = undefined;
    try {
      workflowJobResult = await WorkflowJobQuery.byIdAsync(graphqlClient, jobId, {
        useCache: false,
      });
      return moveToWorkflowStepSelectionState(prevState, { job: workflowJobResult });
    } catch {}
    if (nonInteractive && !workflowJobResult) {
      return moveToWorkflowSelectionErrorState(
        prevState,
        'No workflow job found that matched the provided ID'
      );
    } else {
      // The passed in ID may be a run ID, pass it back to run selection action
      return moveToWorkflowRunSelectionState(prevState, { runId: jobId });
    }
  } else {
    // No job ID was passed in
    if (nonInteractive) {
      return moveToWorkflowSelectionErrorState(
        prevState,
        'No workflow job ID provided in non-interactive mode'
      );
    } else if (!runId) {
      // If no jobId or runId, we should go back to run selection
      return moveToWorkflowRunSelectionState(prevState);
    }
    const workflowRunResult = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, runId, {
      useCache: false,
    });
    if (!workflowRunResult) {
      return moveToWorkflowSelectionErrorState(
        prevState,
        'No workflow run found that matched the provided ID'
      );
    }
    const choices: Choice[] = [
      ...workflowRunResult.jobs.map((job, i) => choiceFromWorkflowJob(job, i)),
      {
        title: 'Go back and select a different workflow run',
        value: -1,
      },
    ];
    const selectedJobIndex = (
      await promptAsync({
        type: 'select',
        name: 'selectedJob',
        message: 'Select a job:',
        choices,
      })
    ).selectedJob;
    if (selectedJobIndex === -1) {
      return moveToWorkflowRunSelectionState(prevState);
    }
    const selectedJob = workflowRunResult.jobs[selectedJobIndex] as WorkflowJobResult;
    return moveToWorkflowStepSelectionState(prevState, { job: selectedJob });
  }
};

// eslint-disable-next-line async-protect/async-suffix
export const workflowStepSelectionAction: WorkflowCommandSelectionAction = async prevState => {
  const { job, allSteps } = prevState;
  Log.debug(`workflowStepSelectionAction: job = ${job?.id}, allSteps = ${allSteps}`);
  if (!job) {
    return moveToWorkflowSelectionErrorState(prevState, 'No job found');
  }
  const logs = await fetchAndProcessLogsFromJobAsync(prevState, job);
  if (!logs) {
    return moveToWorkflowSelectionErrorState(prevState, 'No logs found');
  }
  if (allSteps) {
    return moveToWorkflowSelectionFinishedState(prevState, { step: '', logs });
  }
  const choices: Choice[] = [
    ...choicesFromWorkflowLogs(logs),
    {
      title: 'Go back and select a different workflow job',
      value: 'go-back',
    },
  ];
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
    return moveToWorkflowJobSelectionState(prevState, {
      runId: job.workflowRun.id,
      jobId: undefined,
    });
  }
  return moveToWorkflowSelectionFinishedState(prevState, { step: selectedStep, logs });
};

export const executeWorkflowSelectionActionsAsync: WorkflowCommandSelectionAction =
  async prevState => {
    let currentState = prevState;
    while (
      currentState.state !== WorkflowCommandSelectionStateValue.FINISH &&
      currentState.state !== WorkflowCommandSelectionStateValue.ERROR
    ) {
      Log.debug(`${currentState.state}`);
      switch (currentState.state) {
        case WorkflowCommandSelectionStateValue.WORKFLOW_JOB_SELECTION:
          currentState = await workflowJobSelectionAction(currentState);
          break;
        case WorkflowCommandSelectionStateValue.WORKFLOW_RUN_SELECTION:
          currentState = await workflowRunSelectionAction(currentState);
          break;
        case WorkflowCommandSelectionStateValue.WORKFLOW_STEP_SELECTION:
          currentState = await workflowStepSelectionAction(currentState);
          break;
      }
    }
    return currentState;
  };
