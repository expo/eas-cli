import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  WorkflowCommandSelectionState,
  WorkflowCommandSelectionStateValue,
  executeWorkflowSelectionActionsAsync,
} from '../../commandUtils/workflow/stateMachine';
import { WorkflowLogLine, WorkflowLogs } from '../../commandUtils/workflow/types';
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

export default class WorkflowLogView extends EasCommand {
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
    const { args, flags } = await this.parse(WorkflowLogView);

    const nonInteractive = flags['non-interactive'];
    const allSteps = nonInteractive ? true : flags['all-steps'];
    Log.debug(`allSteps = ${allSteps}`);
    Log.debug(`nonInteractive = ${nonInteractive}`);
    Log.debug(`flags.json = ${flags.json}`);
    Log.debug(`args.id = ${args.id}`);

    const {
      loggedIn: { graphqlClient },
      projectId,
    } = await this.getContextAsync(WorkflowLogView, {
      nonInteractive,
    });

    if (flags.json) {
      enableJsonOutput();
    }

    const finalSelectionState: WorkflowCommandSelectionState =
      await executeWorkflowSelectionActionsAsync({
        graphqlClient,
        projectId,
        nonInteractive,
        allSteps,
        state: WorkflowCommandSelectionStateValue.WORKFLOW_JOB_SELECTION,
        jobId: args.id,
      });

    if (finalSelectionState.state === WorkflowCommandSelectionStateValue.ERROR) {
      Log.error(finalSelectionState.message);
      return;
    }

    const logs = finalSelectionState?.logs as unknown as WorkflowLogs | null;
    if (allSteps) {
      if (logs) {
        if (flags.json) {
          printJsonOnlyOutput(Object.fromEntries(logs));
        } else {
          printLogsForAllSteps(logs);
        }
      }
    } else {
      const selectedStep = finalSelectionState?.step as unknown as string;
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
