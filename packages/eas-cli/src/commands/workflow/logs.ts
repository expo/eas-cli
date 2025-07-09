import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  WorkflowCommandSelectionContext,
  WorkflowCommandSelectionState,
  WorkflowJobResult,
  WorkflowLogLine,
  WorkflowLogs,
  processLogsFromJobAsync,
  workflowJobSelectionAction,
  workflowRunSelectionAction,
  workflowStepSelectionAction,
} from '../../commandUtils/workflows';
import Log from '../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

function printLogsForAllSteps(logs: WorkflowLogs): void {
  [...logs.keys()].forEach(step => {
    const logLines = logs.get(step);
    if (logLines) {
      Log.log(`Step: ${step}`);
      logLines.forEach(line => {
        Log.log(`  ${line.time} ${line.msg}`);
      });
    }
    Log.addNewLineIfNone();
  });
}

export default class WorkflowView extends EasCommand {
  static override description =
    'view logs for a workflow run, selecting a job and step to view. You can pass in either a workflow run ID or a job ID. If no ID is passed in, you will be prompted to select from recent workflow runs for the current project.';

  static override flags = {
    ...EasJsonOnlyFlag,
    ...EASNonInteractiveFlag,
    'all-steps': Flags.boolean({
      description:
        'Print all logs, rather than prompting for a specific step. This will be automatically set when in non-interactive mode.',
      default: false,
    }),
  };

  static override args = [
    { name: 'id', description: 'ID of the workflow run or workflow job to view logs for' },
  ];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowView);

    const nonInteractive = flags['non-interactive'];
    const allSteps = flags['all-steps'] || nonInteractive;

    const {
      loggedIn: { graphqlClient },
      projectId,
    } = await this.getContextAsync(WorkflowView, {
      nonInteractive,
    });

    if (flags.json) {
      enableJsonOutput();
    }

    if (nonInteractive && !args.id) {
      throw new Error('If non-interactive, this command requires a workflow job ID as argument');
    }

    let currentActionSelectionContext: WorkflowCommandSelectionContext = {
      graphqlClient,
      projectId,
      state: WorkflowCommandSelectionState.START,
      jobId: args.id,
    };

    if (nonInteractive && !args.id) {
      currentActionSelectionContext = {
        ...currentActionSelectionContext,
        state: WorkflowCommandSelectionState.ERROR,
        message: 'If non-interactive, this command requires a workflow job ID as argument',
      };
    }

    let job: WorkflowJobResult;
    let logs: WorkflowLogs | null = null;

    while (currentActionSelectionContext.state !== WorkflowCommandSelectionState.FINISH) {
      if (Log.isDebug) {
        Log.log(`${currentActionSelectionContext.state}`);
      }
      switch (currentActionSelectionContext.state) {
        case WorkflowCommandSelectionState.START:
          currentActionSelectionContext = await workflowJobSelectionAction(
            currentActionSelectionContext
          );
          if (currentActionSelectionContext.state === WorkflowCommandSelectionState.ERROR) {
            if (!nonInteractive) {
              currentActionSelectionContext = {
                ...currentActionSelectionContext,
                state: WorkflowCommandSelectionState.WORKFLOW_RUN_SELECTION,
                runId: args.id,
                jobId: undefined,
              };
            }
          }
          break;
        case WorkflowCommandSelectionState.WORKFLOW_RUN_SELECTION:
          currentActionSelectionContext = await workflowRunSelectionAction(
            currentActionSelectionContext
          );
          break;
        case WorkflowCommandSelectionState.WORKFLOW_JOB_SELECTION:
          currentActionSelectionContext = await workflowJobSelectionAction(
            currentActionSelectionContext
          );
          break;
        case WorkflowCommandSelectionState.WORKFLOW_STEP_SELECTION:
          if (!currentActionSelectionContext.job) {
            currentActionSelectionContext = {
              ...currentActionSelectionContext,
              state: WorkflowCommandSelectionState.ERROR,
              message: 'No job found',
            };
            break;
          }
          job = currentActionSelectionContext?.job as unknown as WorkflowJobResult;
          logs = await processLogsFromJobAsync(job);
          if (!logs) {
            currentActionSelectionContext = {
              ...currentActionSelectionContext,
              state: WorkflowCommandSelectionState.ERROR,
              message: 'No logs found',
            };
          } else if (allSteps) {
            currentActionSelectionContext = {
              ...currentActionSelectionContext,
              state: WorkflowCommandSelectionState.FINISH,
            };
          } else {
            currentActionSelectionContext = await workflowStepSelectionAction({
              ...currentActionSelectionContext,
              logs,
            });
          }
          break;
        case WorkflowCommandSelectionState.ERROR:
          Log.error(currentActionSelectionContext.message);
          return;
      }
    }
    if (allSteps) {
      if (logs) {
        if (flags.json) {
          printJsonOnlyOutput(Object.fromEntries(logs));
        } else {
          printLogsForAllSteps(logs);
        }
      }
    } else {
      const selectedStep = currentActionSelectionContext?.step as unknown as string;
      const logLines = logs?.get(selectedStep);
      if (logLines) {
        if (flags.json) {
          const output: { [key: string]: WorkflowLogLine[] | null } = {};
          output[selectedStep] = logLines ?? null;
          printJsonOnlyOutput(output);
        } else {
          logLines.forEach(line => {
            Log.log(`  ${line.time} ${line.msg}`);
          });
        }
      }
    }
  }
}
