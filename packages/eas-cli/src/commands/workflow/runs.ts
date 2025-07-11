import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { processWorkflowRuns } from '../../commandUtils/workflow/utils';
import { WorkflowRunFragment, WorkflowRunStatus } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class WorkflowRunList extends EasCommand {
  static override description =
    'list recent workflow runs for this project, with their IDs, statuses, and timestamps';

  static override flags = {
    workflow: Flags.string({
      description:
        'If present, the query will only return runs for the specified workflow file name',
      required: false,
    }),
    status: Flags.enum({
      description: 'If present, filter the returned runs to select those with the specified status',
      required: false,
      options: Object.values(WorkflowRunStatus),
    }),
    ...EasJsonOnlyFlag,
    limit: getLimitFlagWithCustomValues({ defaultTo: 10, limit: 100 }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(WorkflowRunList);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowRunList, {
      nonInteractive: true,
    });
    if (flags.json) {
      enableJsonOutput();
    }

    const workflowFileName = flags.workflow;
    const status = flags.status;
    const limit = flags.limit ?? 10;

    let runs: WorkflowRunFragment[];
    if (workflowFileName) {
      runs = await WorkflowRunQuery.byAppIdFileNameAndStatusAsync(
        graphqlClient,
        projectId,
        workflowFileName,
        status,
        limit
      );
    } else {
      runs = await AppQuery.byIdWorkflowRunsFilteredByStatusAsync(
        graphqlClient,
        projectId,
        status,
        limit
      );
    }

    const result = processWorkflowRuns(runs);

    if (flags.json) {
      printJsonOnlyOutput(result);
      return;
    }

    Log.addNewLineIfNone();
    result.forEach(run => {
      Log.log(
        formatFields([
          { label: 'Run ID', value: run.id },
          { label: 'Workflow', value: run.workflowFileName },
          { label: 'Status', value: run.status },
          { label: 'Started At', value: run.startedAt },
          { label: 'Finished At', value: run.finishedAt },
          { label: 'Trigger Type', value: run.triggerType },
          { label: 'Trigger', value: run.trigger ?? 'null' },
          { label: 'Git Commit Message', value: run.gitCommitMessage ?? 'null' },
        ])
      );
      Log.addNewLineIfNone();
    });
  }
}
