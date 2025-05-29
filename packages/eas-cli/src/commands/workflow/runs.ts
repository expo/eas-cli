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
  startedAt: string | null;
  finishedAt: string | null;
  workflowId: string;
  workflowName: string | null;
  workflowFileName: string | null;
};

function processWorkflowRuns(
  runs: AppWorkflowRunsFragment['runs'],
  params: {
    workflowId?: string | undefined;
    workflowFileName?: string | undefined;
    status?: string | undefined;
  }
): WorkflowRunResult[] {
  const { workflowId, workflowFileName, status } = params;
  return runs.edges
    .filter(edge => {
      if (workflowId && edge.node.workflow.id !== workflowId) {
        return false;
      }
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

export default class ProjectWorkflowRunList extends EasCommand {
  static override description =
    'list recent workflow runs for this project, with their IDs, statuses, and timestamps';

  static override flags = {
    /*
    workflowId: Flags.string({
      description:
        'If present, filter the returned runs to select those for the specified workflow ID',
      required: false,
    }),
     */
    workflow: Flags.string({
      description:
        'If present, filter the returned runs to select those for the specified workflow file name',
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

    // const workflowId = flags.workflowId;
    const workflowFileName = flags.workflow;
    const status = flags.status;
    const limit = flags.limit ?? 10;

    const byId = await AppQuery.byIdWorkflowRunsAsync(graphqlClient, projectId, limit);
    if (!byId) {
      throw new Error(`Could not find project with id: ${projectId}`);
    }

    const result = processWorkflowRuns(byId.runs, { /* workflowId, */ workflowFileName, status });

    if (flags.json) {
      Log.log(JSON.stringify(result, null, 2));
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
