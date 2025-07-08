import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  WorkflowJobResult,
  WorkflowLogLine,
  processLogsFromJobAsync,
  selectWorkflowRunIfNeededAsync,
} from '../../commandUtils/workflows';
import { WorkflowJobQuery } from '../../graphql/queries/WorkflowJobQuery';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

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

    const allSteps = flags.allSteps;
    const nonInteractive = flags['non-interactive'];
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

    const idToQuery = await selectWorkflowRunIfNeededAsync(graphqlClient, projectId, args.id);

    let workflowJobResult;
    let workflowRunResult;
    try {
      workflowJobResult = await WorkflowJobQuery.byIdAsync(graphqlClient, idToQuery, {
        useCache: false,
      });
    } catch {}

    if (!workflowJobResult) {
      if (nonInteractive) {
        throw new Error(
          'Non-interactive mode requires a workflow job ID as argument, and the provided ID does not match a workflow job.'
        );
      }
      workflowRunResult = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, idToQuery, {
        useCache: false,
      });
    }

    let job: WorkflowJobResult;
    if (workflowJobResult) {
      job = workflowJobResult;
    } else {
      const jobIndex: number = (
        await promptAsync({
          type: 'select',
          name: 'selectedJob',
          message: 'Select a job:',
          choices: workflowRunResult?.jobs.map((job, i) => ({
            title: `${job.name} - ${job.status}`,
            value: i,
          })),
        })
      ).selectedJob;
      job = workflowRunResult?.jobs[jobIndex] as WorkflowJobResult;
    }

    const logs = await processLogsFromJobAsync(job);
    if (!logs) {
      Log.log('No logs found');
      return;
    }

    if (nonInteractive || allSteps) {
      if (flags.json) {
        printJsonOnlyOutput(logs);
        return;
      }
      [...logs.keys()].forEach(step => {
        const logLines = logs.get(step);
        if (logLines) {
          Log.log(formatFields([{ label: 'Step', value: step }]));
          logLines.forEach(line => {
            Log.log(`  ${line.time} ${line.msg}`);
          });
        }
        Log.addNewLineIfNone();
      });
      return;
    }

    const selectedStep: string =
      (
        await promptAsync({
          type: 'select',
          name: 'selectedStep',
          message: 'Select a step:',
          choices: Array.from(logs.keys()).map(step => {
            const logLines = logs.get(step);
            const stepStatus =
              logLines?.filter(line => line.marker === 'end-step')[0]?.result ?? '';
            return {
              title: `${step} - ${stepStatus}`,
              value: step,
            };
          }),
        })
      ).selectedStep ?? '';

    const logLines = logs.get(selectedStep);

    if (flags.json) {
      const output: { [key: string]: WorkflowLogLine[] | null } = {};
      output[selectedStep] = logLines ?? null;
      printJsonOnlyOutput(output);
      return;
    }

    if (logLines) {
      logLines.forEach(line => {
        Log.log(`  ${line.time} ${line.msg}`);
      });
    }
  }
}
