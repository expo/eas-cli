import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { WorkflowRun, WorkflowRunStatus } from '../../graphql/generated';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { WorkflowQuery } from '../../graphql/queries/WorkflowQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export type WorkflowRunResult = {
  id: string | null;
  status: string | null;
  gitCommitMessage?: string | null;
  gitCommitHash?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  workflowId: string | null;
  workflowName: string | null;
  workflowFileName: string | null;
};

function processWorkflowRuns(
  runs: Partial<WorkflowRun>[],
  params: {
    workflowFileName?: string | undefined;
    status?: string | undefined;
  }
): WorkflowRunResult[] {
  const { workflowFileName, status } = params;
  return runs
    .filter(run => {
      if (workflowFileName && run.workflow?.fileName !== workflowFileName) {
        return false;
      }
      if (status && run.status !== status) {
        return false;
      }
      return true;
    })
    .map(run => {
      const finishedAt = run.status === WorkflowRunStatus.InProgress ? null : run.updatedAt;
      return {
        id: run.id ?? null,
        status: run.status ?? null,
        gitCommitMessage: run.gitCommitMessage ?? null,
        gitCommitHash: run.gitCommitHash ?? null,
        startedAt: run.createdAt ?? null,
        finishedAt,
        workflowId: run.workflow?.id ?? null,
        workflowName: run.workflow?.name ?? null,
        workflowFileName: run.workflow?.fileName ?? null,
      };
    });
}

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

    const workflowFileName = flags.workflow;
    const status = flags.status;
    const limit = flags.limit ?? 10;

    let runs: Partial<WorkflowRun>[] = [];
    if (workflowFileName) {
      const workflows = await AppQuery.byIdWorkflowsAsync(graphqlClient, projectId);
      const workflowsFiltered = workflows.filter(
        workflow => workflow.fileName === workflowFileName
      );
      if (workflowsFiltered.length > 1) {
        throw new Error(`Found multiple workflows with the same file name: ${workflowFileName}`);
      }
      if (!workflowsFiltered.length || !workflowsFiltered[0].id) {
        Log.warn(`No workflows found with file name: ${workflowFileName}`);
      } else {
        const workflowId = workflowsFiltered[0].id;
        runs = await WorkflowQuery.byIdRunsAsync(graphqlClient, workflowId ?? '', limit);
      }
    } else {
      runs = await AppQuery.byIdWorkflowRunsAsync(graphqlClient, projectId, limit);
    }

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
          { label: 'Run ID', value: run.id ?? '-' },
          { label: 'Workflow', value: run.workflowFileName ?? '-' },
          { label: 'Status', value: run.status ?? '-' },
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
