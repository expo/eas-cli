/**
 * EAS Workflow Status Command
 *
 * This command shows the status of an existing workflow run.
 *
 * If no run ID is provided, you will be prompted to select from recent workflow runs for the current project.
 *
 * If the selected run is still in progress, the command will show the progress of the run, with an option
 * to show periodic status updates while waiting for completion (similar to `eas workflow:run --wait`).
 *
 */

import { Flags } from '@oclif/core';
import { boolish } from 'getenv';

import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  choiceFromWorkflowRun,
  processWorkflowRuns,
  showWorkflowStatusAsync,
  workflowRunExitCodes,
} from '../../commandUtils/workflow/utils';
import { WorkflowRunStatus } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log, { link } from '../../log';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class WorkflowStatus extends EasCommand {
  static override description =
    'show the status of an existing workflow run. If no run ID is provided, you will be prompted to select from recent workflow runs for the current project.';

  static override args = [
    {
      name: 'WORKFLOW_RUN_ID',
      description: 'A workflow run ID.',
    },
  ];

  static override flags = {
    ...EASNonInteractiveFlag,
    wait: Flags.boolean({
      default: false,
      allowNo: true,
      description: 'Exit codes: 0 = success, 11 = failure, 12 = canceled, 13 = wait aborted.',
      summary: 'Wait for workflow run to complete. Defaults to false.',
    }),
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags, args } = await this.parse(WorkflowStatus);

    if (flags.json) {
      enableJsonOutput();
    }

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowStatus, {
      nonInteractive: flags['non-interactive'],
      withServerSideEnvironment: null,
    });

    const {
      projectId,
      exp: { slug: projectName },
    } = await getDynamicPrivateProjectConfigAsync();
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    let workflowRunId = args.WORKFLOW_RUN_ID;

    if (!workflowRunId && flags['non-interactive']) {
      throw new Error('Workflow run ID is required in non-interactive mode');
    }
    if (!workflowRunId) {
      const queryResult = await AppQuery.byIdWorkflowRunsFilteredByStatusAsync(
        graphqlClient,
        projectId,
        undefined,
        50
      );
      const runs = processWorkflowRuns(queryResult);
      if (runs.length === 0) {
        Log.warn('No workflow runs to show');
        return;
      }
      const answers = await promptAsync({
        type: 'select',
        name: 'selectedRun',
        message: 'Select a workflow run:',
        choices: runs.map(run => choiceFromWorkflowRun(run)),
      });
      workflowRunId = answers.selectedRun;
    }

    Log.addNewLineIfNone();
    Log.log(`See logs: ${link(getWorkflowRunUrl(account.name, projectName, workflowRunId))}`);
    Log.addNewLineIfNone();

    const spinnerUsesStdErr = boolish('CI', false) || flags.json;

    await showWorkflowStatusAsync(graphqlClient, {
      workflowRunId,
      spinnerUsesStdErr,
      waitForCompletion: flags.wait,
    });
    const workflowRun = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, workflowRunId, {
      useCache: false,
    });
    const status = workflowRun.status;

    if (flags.json) {
      printJsonOnlyOutput({
        ...workflowRun,
        url: getWorkflowRunUrl(account.name, projectName, workflowRunId),
      });
    }

    if (status === WorkflowRunStatus.Failure) {
      process.exit(workflowRunExitCodes.WORKFLOW_FAILED);
    } else if (status === WorkflowRunStatus.Canceled) {
      process.exit(workflowRunExitCodes.WORKFLOW_CANCELED);
    }
  }
}
