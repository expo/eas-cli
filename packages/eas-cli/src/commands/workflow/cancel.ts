import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { choiceFromWorkflowRun, processWorkflowRuns } from '../../commandUtils/workflow/utils';
import { WorkflowRunStatus } from '../../graphql/generated';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';

export default class WorkflowRunCancel extends EasCommand {
  static override description =
    'Cancel one or more workflow runs. If no workflow run IDs are provided, you will be prompted to select in-progress or queued runs to cancel.';

  static override strict = false;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };
  static override flags = {
    ...EASNonInteractiveFlag,
  };

  async runAsync(): Promise<void> {
    const { argv, flags } = await this.parse(WorkflowRunCancel);
    // strict = false, so argv holds the variadic run IDs; oclif parses known
    // flags like --non-interactive out of argv.
    const nonInteractive = flags['non-interactive'];
    const workflowRunIds = new Set(argv as string[]);

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
      // The runs filter takes a single status, so query each picker status separately.
      const pickerStatuses = [WorkflowRunStatus.InProgress, WorkflowRunStatus.Waiting];
      const runsByStatus = await Promise.all(
        pickerStatuses.map(status =>
          AppQuery.byIdWorkflowRunsFilteredByStatusAsync(graphqlClient, projectId, status, 50)
        )
      );
      const runs = processWorkflowRuns(runsByStatus.flat());
      if (runs.length === 0) {
        Log.warn('No workflow runs to cancel');
        return;
      }
      const answers = await promptAsync({
        type: 'multiselect',
        name: 'selectedRuns',
        message: 'Select workflow runs to cancel',
        choices: runs.map(run => choiceFromWorkflowRun(run)),
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
