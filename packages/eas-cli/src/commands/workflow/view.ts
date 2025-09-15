import chalk from 'chalk';

import { formatGraphQLBuildArtifacts } from '../../build/utils/formatBuild';
import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  WorkflowCommandSelectionStateValue,
  workflowRunSelectionAction,
} from '../../commandUtils/workflow/stateMachine';
import { WorkflowTriggerType } from '../../commandUtils/workflow/types';
import { computeTriggerInfoForWorkflowRun } from '../../commandUtils/workflow/utils';
import {
  BuildArtifacts,
  WorkflowArtifact,
  WorkflowJobType,
  WorkflowRunByIdWithJobsQuery,
} from '../../graphql/generated';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log, { link } from '../../log';
import formatFields, { FormatFieldsItem } from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

type ReducedWorkflowArtifact = Omit<
  WorkflowArtifact,
  'createdAt' | 'jobRun' | 'storageType' | 'updatedAt'
>;

type WorkflowJobOutput =
  WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']['jobs'][number]['outputs'];

type WorkflowJobResult = WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']['jobs'][number] & {
  artifacts?: ReducedWorkflowArtifact[] | BuildArtifacts | undefined;
  output?: WorkflowJobOutput | undefined;
};

type WorkflowRunResult = WorkflowRunByIdWithJobsQuery['workflowRuns']['byId'] & {
  logURL?: string | undefined;
  triggerType?: WorkflowTriggerType | undefined;
  trigger?: string | null;
  jobs: WorkflowJobResult[];
};

const processedOutputs: (job: WorkflowJobResult) => FormatFieldsItem[] = job => {
  const result: FormatFieldsItem[] = [];
  const keys = job.outputs ? Object.keys(job.outputs) : [];
  keys.forEach(key => {
    result.push({
      label: `    ${key}`,
      get value(): string {
        const value = job.outputs[key];
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      },
    });
  });
  return result;
};

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
      throw new Error('If non-interactive, this command requires a workflow run ID as argument');
    }

    const actionResult = await workflowRunSelectionAction({
      graphqlClient,
      projectId,
      nonInteractive,
      allSteps: false,
      state: WorkflowCommandSelectionStateValue.WORKFLOW_RUN_SELECTION,
      runId: args.id,
    });
    if (actionResult.state === WorkflowCommandSelectionStateValue.ERROR) {
      Log.error(actionResult.message);
      return;
    }
    const idToQuery = actionResult.runId ?? '';

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

    const processedJobs: WorkflowJobResult[] = result.jobs.map(job => {
      const processedJob = job as WorkflowJobResult;
      if (job.type === WorkflowJobType.Build) {
        processedJob.artifacts = job.turtleBuild?.artifacts ?? undefined;
      } else {
        processedJob.artifacts = job.turtleJobRun?.artifacts;
      }
      delete processedJob.turtleJobRun;
      return processedJob;
    });
    result.jobs = processedJobs;

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
          value: result.gitCommitMessage?.split('\n')[0] ?? 'null',
        },
        { label: 'Status', value: result.status },
        { label: 'Errors', value: result.errors.map(error => error.title).join('\n') },
        { label: 'Created At', value: result.createdAt },
        { label: 'Updated At', value: result.updatedAt },
        { label: 'Log URL', value: link(result.logURL) },
      ])
    );
    Log.addNewLineIfNone();
    result.jobs.forEach((job: WorkflowJobResult) => {
      Log.log(
        formatFields([
          { label: 'Job ID', value: job.id },
          { label: '  Key', value: job.key },
          { label: '  Name', value: job.name },
          { label: '  Status', value: job.status },
          { label: '  Type', value: job.type },
          { label: '  Created At', value: job.createdAt },
          { label: '  Updated At', value: job.updatedAt },
        ])
      );
      if (job.errors.length > 0) {
        Log.gray(chalk.dim('  Errors:'));
        job.errors.forEach(error => {
          Log.log(formatFields([{ label: `    ${error.title}`, value: `${error.message}` }]));
        });
      }
      if (job.outputs) {
        const outputs = processedOutputs(job);
        if (outputs.length > 0) {
          Log.gray(chalk.dim('  Outputs:'));
          Log.log(formatFields(outputs));
        }
      }
      if (job.type === WorkflowJobType.Build) {
        if (job.turtleBuild?.artifacts) {
          Log.gray(chalk.dim('  Artifacts:'));
          Log.log(
            formatFields(
              formatGraphQLBuildArtifacts(job.turtleBuild).map(item => {
                item.label = `    ${item.label}`;
                return item;
              })
            )
          );
        }
      } else {
        const jobArtifacts = job.artifacts as ReducedWorkflowArtifact[];
        if (jobArtifacts?.length) {
          Log.gray(chalk.dim('  Artifacts:'));
          jobArtifacts.forEach(artifact => {
            Log.log(
              formatFields([
                { label: '    ID', value: artifact.id },
                { label: '    Name', value: artifact.name },
                { label: '    Content Type', value: artifact?.contentType ?? 'null' },
                {
                  label: '    File Size Bytes',
                  value: artifact?.fileSizeBytes ? `${artifact.fileSizeBytes}` : 'null',
                },
                { label: '    Filename', value: artifact.filename },
                {
                  label: '    Download URL',
                  value: artifact?.downloadUrl ? link(artifact.downloadUrl) : 'null',
                },
              ])
            );
            Log.addNewLineIfNone();
          });
        }
      }

      Log.addNewLineIfNone();
    });
  }
}
