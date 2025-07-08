import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import {
  computePromptInfoForWorkflowRunSelection,
  processWorkflowRuns,
} from '../../commandUtils/workflows';
import { WorkflowRunStatus } from '../../graphql/generated';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';

export default class WorkflowRunCancel extends EasCommand {
  static override description =
    'Cancel one or more workflow runs. If no workflow run IDs are provided, you will be prompted to select IN_PROGRESS runs to cancel.';

  static override strict = false;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };
  static override flags = {
    ...EASNonInteractiveFlag,
  };

  async runAsync(): Promise<void> {
    const { argv } = await this.parse(WorkflowRunCancel);
    let nonInteractive = false;
    const workflowRunIds: Set<string> = new Set();

    // Custom parsing of argv
    const tokens: string[] = [...argv];
    while (tokens.length > 0) {
      const token = tokens.shift();
      if (token === '--non-interactive') {
        nonInteractive = true;
        continue;
      } else if (token) {
        workflowRunIds.add(token);
      }
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowRunCancel, {
      nonInteractive,
    });

    if (workflowRunIds.size === 0) {
      if (nonInteractive) {
        throw new Error('Must supply workflow run IDs as arguments when in non-interactive mode');
      }
      // Run the workflow run list query and select runs to cancel
      const queryResult = await AppQuery.byIdWorkflowRunsFilteredByStatusAsync(
        graphqlClient,
        projectId,
        WorkflowRunStatus.InProgress,
        50
      );
      const runs = processWorkflowRuns(queryResult);
      if (runs.length === 0) {
        Log.warn('No workflow runs to cancel');
        return;
      }
      const answers = await promptAsync({
        type: 'multiselect',
        name: 'selectedRuns',
        message: 'Select IN_PROGRESS workflow runs to cancel',
        choices: runs.map(run => computePromptInfoForWorkflowRunSelection(run)),
      });
      answers.selectedRuns.forEach((id: string) => {
        workflowRunIds.add(id);
      });
      if (workflowRunIds.size === 0) {
        Log.warn('No workflow runs to cancel');
        return;
      }
    }

    Log.addNewLineIfNone();
    for (const workflowRunId of workflowRunIds) {
      try {
        await WorkflowRunMutation.cancelWorkflowRunAsync(graphqlClient, {
          workflowRunId,
        });

        Log.log(`Workflow run ${workflowRunId} has been canceled.`);
      } catch (e: any) {
        Log.error(`Failed to cancel workflow run ${workflowRunId}: ${e}`);
      }
    }
    Log.addNewLineIfNone();
  }
}
