import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { AppWorkflowRunsFragment, WorkflowRunStatus } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export type WorkflowRunResult = {
  id: string;
  status: string;
  gitCommitMessage?: string | null;
  gitCommitHash?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  workflowId: string;
  workflowName: string | null;
  workflowFileName: string | null;
};

function processWorkflowRuns(
  runs: AppWorkflowRunsFragment['runs'],
  params: {
    workflowFileName?: string | undefined;
    status?: string | undefined;
  }
): WorkflowRunResult[] {
  const { workflowFileName, status } = params;
  return runs.edges
    .filter(edge => {
      if (workflowFileName && edge.node.workflow.fileName !== workflowFileName) {
        return false;
      }
      if (status && edge.node.status !== status) {
        return false;
      }
      return true;
    })
    .map(edge => {
      const finishedAt =
        edge.node.status === WorkflowRunStatus.InProgress ? null : edge.node.updatedAt;
      return {
        id: edge.node.id,
        status: edge.node.status,
        gitCommitMessage: edge.node.gitCommitMessage,
        gitCommitHash: edge.node.gitCommitHash,
        startedAt: edge.node.createdAt,
        finishedAt,
        workflowId: edge.node.workflow.id,
        workflowName: edge.node.workflow.name ?? null,
        workflowFileName: edge.node.workflow.fileName ?? null,
      };
    });
}

export default class WorkflowRunList extends EasCommand {
  static override description =
    'list recent workflow runs for this project, with their IDs, statuses, and timestamps';

  static override flags = {
    workflow: Flags.string({
      description:
        'If present, filter the returned runs to select those for the specified workflow file name',
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

    const workflowFileName = flags.workflow;
    const status = flags.status;
    const limit = flags.limit ?? 10;

    const runs = await AppQuery.byIdWorkflowRunsAsync(graphqlClient, projectId, limit);

    const result = processWorkflowRuns(runs, { workflowFileName, status });

    if (flags.json) {
      enableJsonOutput();
      printJsonOnlyOutput(result);
      return;
    }

    Log.addNewLineIfNone();
    result.forEach(run => {
      Log.log(
        formatFields([
          { label: 'Run ID', value: run.id },
          { label: 'Workflow', value: run.workflowFileName ?? '-' },
          { label: 'Status', value: run.status },
          { label: 'Started At', value: run.startedAt ?? '-' },
          { label: 'Finished At', value: run.finishedAt ?? '-' },
          { label: 'Git Commit Message', value: run.gitCommitMessage ?? 'null' },
          { label: 'Git Commit Hash', value: run.gitCommitHash ?? 'null' },
        ])
      );
      Log.addNewLineIfNone();
    });
  }
}
