import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import Log from '../../log';

export default class WorkflowRunCancel extends EasCommand {
  static override description =
    'cancel a workflow run. You can only cancel runs that are in progress or waiting for action.';

  static override args = [
    { name: 'id', description: 'ID of the workflow run to cancel', required: true },
  ];

  static override flags = {
    all: Flags.boolean({
      description: 'If present, all workflow runs that are IN_PROCESS will be canceled.',
      required: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags, args } = await this.parse(WorkflowRunCancel);
    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowRunCancel, {
      nonInteractive: true,
    });

    const workflowRunId = args.id;
    const all = flags.all ?? false;

    await WorkflowRunMutation.cancelWorkflowRunAsync(graphqlClient, {
      workflowRunId,
    });

    Log.addNewLineIfNone();
    Log.log(`Flag --all was set to ${all}.`);
    Log.log(`Workflow run ${workflowRunId} has been canceled.`);
    Log.addNewLineIfNone();
  }
}
