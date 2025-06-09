import EasCommand from '../../commandUtils/EasCommand';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import Log from '../../log';

export default class WorkflowRunCancel extends EasCommand {
  static override description =
    'Cancel one or more workflow runs. Pass in the --all flag to cancel all runs that have not yet completed.';

  static override strict = false;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { argv } = await this.parse(WorkflowRunCancel);
    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowRunCancel, {
      nonInteractive: true,
    });

    // Custom parsing of argv
    const tokens = [...argv];
    const workflowRunIds: Set<string> = new Set();
    if (tokens.length === 0) {
      throw new Error('Must provide at least one workflow run ID, or the --all flag');
    }

    let all = false;
    while (tokens.length > 0) {
      const token = tokens.shift();
      if (token === '--all') {
        all = true;
      } else {
        workflowRunIds.add(token as unknown as string);
      }
    }
    if (all && workflowRunIds.size > 0) {
      throw new Error('Cannot provide workflow run IDs when using the --all flag');
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
