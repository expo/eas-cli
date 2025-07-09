import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  WorkflowCommandSelectionState,
  WorkflowTriggerType,
  computeTriggerInfoForWorkflowRun,
  workflowRunSelectionAction,
} from '../../commandUtils/workflows';
import { WorkflowRunByIdWithJobsQuery } from '../../graphql/generated';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log, { link } from '../../log';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class WorkflowView extends EasCommand {
  static override description =
    'view details for a workflow run, including jobs. If no run ID is provided, you will be prompted to select from recent workflow runs for the current project.';

  static override flags = {
    ...EasJsonOnlyFlag,
    ...EASNonInteractiveFlag,
  };

  static override args = [{ name: 'id', description: 'ID of the workflow run to view' }];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(WorkflowView);
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

    const actionResult = await workflowRunSelectionAction({
      graphqlClient,
      projectId,
      state: WorkflowCommandSelectionState.START,
      runId: args.id,
    });
    if (actionResult.state === WorkflowCommandSelectionState.ERROR) {
      Log.error(actionResult.message);
      return;
    }
    const idToQuery = actionResult.runId ?? '';

    type WorkflowRunResult = WorkflowRunByIdWithJobsQuery['workflowRuns']['byId'] & {
      logURL?: string;
      triggerType?: WorkflowTriggerType;
      trigger?: string | null;
    };
    const result: WorkflowRunResult = await WorkflowRunQuery.withJobsByIdAsync(
      graphqlClient,
      idToQuery,
      {
        useCache: false,
      }
    );
    const { triggerType, trigger } = computeTriggerInfoForWorkflowRun(result);
    result.triggerType = triggerType;
    result.trigger = trigger;

    result.jobs.forEach(job => {
      delete job.turtleJobRun;
    });
    result.logURL = getWorkflowRunUrl(
      result.workflow.app.ownerAccount.name,
      result.workflow.app.name,
      result.id
    );

    if (flags.json) {
      printJsonOnlyOutput(result);
      return;
    }

    Log.log(
      formatFields([
        { label: 'Run ID', value: result.id },
        { label: 'Workflow', value: result.workflow.fileName },
        { label: 'Trigger Type', value: result.triggerType },
        { label: 'Trigger', value: result.trigger ?? 'null' },
        {
          label: 'Git Commit Message',
          value: result.gitCommitMessage?.split('\n')[0] ?? null ?? 'null',
        },
        { label: 'Status', value: result.status },
        { label: 'Errors', value: result.errors.map(error => error.title).join('\n') },
        { label: 'Created At', value: result.createdAt },
        { label: 'Updated At', value: result.updatedAt },
        { label: 'Log URL', value: link(result.logURL) },
      ])
    );
    Log.addNewLineIfNone();
    result.jobs.forEach(job => {
      Log.log(
        formatFields([
          { label: 'Job ID', value: job.id },
          { label: '  Key', value: job.key },
          { label: '  Name', value: job.name },
          { label: '  Status', value: job.status },
          { label: '  Type', value: job.type },
          { label: '  Created At', value: job.createdAt },
          { label: '  Updated At', value: job.updatedAt },
          { label: '  Outputs', value: JSON.stringify(job.outputs, null, 2) },
          { label: '  Errors', value: job.errors.map(error => error.title).join('\n') },
        ])
      );
      Log.addNewLineIfNone();
    });
  }
}
