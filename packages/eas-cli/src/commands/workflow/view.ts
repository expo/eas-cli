import chalk from 'chalk';

import { buildArtifactFromBuild } from '../../build/utils/formatBuild';
import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  WorkflowCommandSelectionStateValue,
  workflowRunSelectionAction,
} from '../../commandUtils/workflow/stateMachine';
import {
  WorkflowBuildJobOutput,
  WorkflowCustomJobOutput,
  WorkflowSubmitJobOutput,
  WorkflowTestflightJobOutput,
  WorkflowTriggerType,
  WorkflowUpdateJobOutput,
} from '../../commandUtils/workflow/types';
import { computeTriggerInfoForWorkflowRun } from '../../commandUtils/workflow/utils';
import { WorkflowJobType, WorkflowRunByIdWithJobsQuery } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log, { link } from '../../log';
import formatFields, { FormatFieldsItem } from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

type WorkflowArtifact = {
  id: string;
  name: string;
  contentType?: string | null;
  fileSizeBytes?: number | null;
  filename: string;
  downloadUrl?: string | null;
};

type WorkflowOutputWithBuildArtifactURL =
  WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']['jobs'][number]['outputs'] & {
    build_artifact_url?: string | null;
  };

type WorkflowJobResult = WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']['jobs'][number] & {
  artifacts?: WorkflowArtifact[] | undefined;
  output?: WorkflowOutputWithBuildArtifactURL | undefined;
};

type WorkflowRunResult = WorkflowRunByIdWithJobsQuery['workflowRuns']['byId'] & {
  logURL?: string | undefined;
  triggerType?: WorkflowTriggerType | undefined;
  trigger?: string | null;
  jobs: WorkflowJobResult[];
};

const processedOutputs: (job: WorkflowJobResult) => FormatFieldsItem[] = job => {
  const result: FormatFieldsItem[] = [];
  switch (job.type) {
    case WorkflowJobType.GetBuild:
    case WorkflowJobType.Build: {
      const buildOutput = job.outputs as WorkflowBuildJobOutput;
      buildOutput.build_id && result.push({ label: '    Build ID', value: buildOutput.build_id });
      job.outputs?.build_artifact_url &&
        result.push({ label: '    Build Artifact URL', value: job.outputs?.build_artifact_url });
      buildOutput.app_build_version &&
        result.push({ label: '    App Build Version', value: buildOutput.app_build_version });
      buildOutput.app_identifier &&
        result.push({ label: '    App Identifier', value: buildOutput.app_identifier });
      buildOutput.app_version &&
        result.push({ label: '    App Version', value: buildOutput.app_version });
      buildOutput.channel && result.push({ label: '    Channel', value: buildOutput.channel });
      buildOutput.distribution &&
        result.push({ label: '    Distribution', value: buildOutput.distribution });
      buildOutput.fingerprint_hash &&
        result.push({ label: '    Fingerprint Hash', value: buildOutput.fingerprint_hash });
      buildOutput.git_commit_hash &&
        result.push({ label: '    Git Commit Hash', value: buildOutput.git_commit_hash });
      buildOutput.platform && result.push({ label: '    Platform', value: buildOutput.platform });
      buildOutput.profile && result.push({ label: '    Profile', value: buildOutput.profile });
      buildOutput.runtime_version &&
        result.push({ label: '    Runtime Version', value: buildOutput.runtime_version });
      buildOutput.sdk_version &&
        result.push({ label: '    SDK Version', value: buildOutput.sdk_version });
      buildOutput.simulator &&
        result.push({ label: '    Simulator', value: buildOutput.simulator });
      break;
    }
    case WorkflowJobType.Submission: {
      const submissionOutput = job.outputs as WorkflowSubmitJobOutput;
      submissionOutput.apple_app_id &&
        result.push({ label: '    Apple App ID', value: submissionOutput.apple_app_id });
      submissionOutput.ios_bundle_identifier &&
        result.push({
          label: '    iOS Bundle Identifier',
          value: submissionOutput.ios_bundle_identifier,
        });
      submissionOutput.android_package_id &&
        result.push({
          label: '    Android Package ID',
          value: submissionOutput.android_package_id,
        });
      break;
    }
    case WorkflowJobType.Testflight: {
      const testflightOutput = job.outputs as WorkflowTestflightJobOutput;
      testflightOutput.apple_app_id &&
        result.push({ label: '    Apple App ID', value: testflightOutput.apple_app_id });
      testflightOutput.ios_bundle_identifier &&
        result.push({
          label: '    iOS Bundle Identifier',
          value: testflightOutput.ios_bundle_identifier,
        });
      break;
    }
    case WorkflowJobType.Update: {
      const updateOutput = job.outputs as WorkflowUpdateJobOutput;
      updateOutput.first_update_group_id &&
        result.push({
          label: '    First Update Group ID',
          value: updateOutput.first_update_group_id,
        });
      updateOutput.updates_json &&
        result.push({ label: '    Updates JSON', value: updateOutput.updates_json });
      break;
    }
    case WorkflowJobType.Custom: {
      const customOutput = job.outputs as WorkflowCustomJobOutput;
      const keys = customOutput ? Object.keys(customOutput) : [];
      keys.forEach(key => {
        result.push({
          label: `    ${key}`,
          get value(): string {
            const value = customOutput[key];
            return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
          },
        });
      });
      break;
    }
    default:
      break;
  }
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

    const buildArtifactUrls = new Map<string, string>();
    for (const job of result.jobs) {
      if (job.outputs?.build_id) {
        const build = await BuildQuery.byIdAsync(graphqlClient, job.outputs.build_id);
        const artifactUrl = buildArtifactFromBuild(build);
        artifactUrl && buildArtifactUrls.set(job.outputs.build_id, artifactUrl);
      }
    }
    const processedJobs: WorkflowJobResult[] = result.jobs.map(job => {
      const processedJob = job as WorkflowJobResult;
      processedJob.artifacts = job.turtleJobRun?.artifacts;
      if (job?.outputs?.build_id && buildArtifactUrls.has(job.outputs.build_id)) {
        const artifactUrl = buildArtifactUrls.get(job.outputs.build_id) ?? null;
        processedJob.outputs = {
          ...job.outputs,
          build_artifact_url: artifactUrl,
        };
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
      if (job.artifacts?.length) {
        Log.gray(chalk.dim('  Artifacts:'));
        job.artifacts.forEach(artifact => {
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
                value: artifact.downloadUrl ? link(artifact.downloadUrl) : 'null',
              },
            ])
          );
        });
      }

      Log.addNewLineIfNone();
    });
  }
}
