import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { AppWorkflowRunsFragment, WorkflowRunStatus } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';

export type WorkflowRunResult = {
  id: string;
  status: string;
  gitCommitMessage?: string | null;
  gitCommitHash?: string | null;
  createdAt: string | null;
  workflowId: string;
  workflowName: string | null;
};

function formatWorkflowRuns(
  runs: AppWorkflowRunsFragment['runs'],
  workflowId?: string | undefined,
  status?: string | undefined
): WorkflowRunResult[] {
  return runs.edges
    .filter(edge => {
      if (workflowId && edge.node.workflow.id !== workflowId) {
        return false;
      }
      if (status && edge.node.status !== status) {
        return false;
      }
      return true;
    })
    .map(edge => {
      return {
        id: edge.node.id,
        status: edge.node.status,
        gitCommitMessage: edge.node.gitCommitMessage,
        gitCommitHash: edge.node.gitCommitHash,
        createdAt: edge.node.createdAt,
        workflowId: edge.node.workflow.id,
        workflowName: edge.node.workflow.name ?? null,
      };
    });
}

export default class ProjectWorkflowRunList extends EasCommand {
  static override description = 'List workflow runs for the current project';

  static override flags = {
    workflowId: Flags.string({
      description:
        'If present, filter the returned runs to select those for the specified workflow ID',
      required: false,
    }),
    status: Flags.string({
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
    const { flags } = await this.parse(ProjectWorkflowRunList);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectWorkflowRunList, {
      nonInteractive: true,
    });

    const workflowId = flags.workflowId;
    const status = flags.status;
    const limit = flags.limit ?? 10;

    const byId = await AppQuery.byIdWorkflowRunsAsync(graphqlClient, projectId, limit);
    if (!byId) {
      throw new Error(`Could not find project with id: ${projectId}`);
    }

    const result = formatWorkflowRuns(byId.runs, workflowId, status);

    if (flags.json) {
      Log.log(JSON.stringify(result, null, 2));
      return;
    }

    Log.addNewLineIfNone();
    result.forEach(run => {
      Log.log(
        formatFields([
          { label: 'ID', value: run.id },
          { label: 'Status', value: run.status },
          { label: 'Git Commit Message', value: run.gitCommitMessage ?? 'null' },
          { label: 'Git Commit Hash', value: run.gitCommitHash ?? 'null' },
          { label: 'Created At', value: run.createdAt ?? 'null' },
          { label: 'Workflow ID', value: run.workflowId ?? 'null' },
          { label: 'Workflow Name', value: run.workflowName ?? 'null' },
        ])
      );
      Log.addNewLineIfNone();
    });
  }
}
