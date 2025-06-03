import { Flags } from '@oclif/core';
import { CombinedError } from '@urql/core';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  WorkflowProjectSourceType,
  WorkflowRunByIdQuery,
  WorkflowRunStatus,
} from '../../graphql/generated';
import { WorkflowRevisionMutation } from '../../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import { WorkflowRunQuery } from '../../graphql/queries/WorkflowRunQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { uploadAccountScopedFileAsync } from '../../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../project/uploadAccountScopedProjectSourceAsync';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { sleepAsync } from '../../utils/promise';
import { WorkflowFile } from '../../utils/workflowFile';

const EXIT_CODES = {
  WORKFLOW_FAILED: 11,
  WORKFLOW_CANCELED: 12,
  WAIT_ABORTED: 13,
};

export default class WorkflowRun extends EasCommand {
  static override description = 'run an EAS workflow';

  static override args = [{ name: 'file', description: 'Path to the workflow file to run' }];

  static override flags = {
    ...EASNonInteractiveFlag,
    wait: Flags.boolean({
      default: false,
      allowNo: true,
      description: 'Exit codes: 0 = success, 11 = failure, 12 = canceled, 13 = wait aborted.',
      summary: 'Wait for workflow run to complete',
    }),
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags, args } = await this.parse(WorkflowRun);

    if (flags.json) {
      enableJsonOutput();
    }

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      vcsClient,
      projectDir,
    } = await this.getContextAsync(WorkflowRun, {
      nonInteractive: flags['non-interactive'],
      withServerSideEnvironment: null,
    });

    let yamlConfig: string;
    try {
      const workflowFileContents = await WorkflowFile.readWorkflowFileContentsAsync({
        projectDir,
        filePath: args.file,
      });
      Log.log(`Using workflow file from ${workflowFileContents.filePath}`);
      yamlConfig = workflowFileContents.yamlConfig;
    } catch (err) {
      Log.error('Failed to read workflow file.');

      throw err;
    }

    const {
      projectId,
      exp: { slug: projectName },
    } = await getDynamicPrivateProjectConfigAsync();
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    try {
      await WorkflowRevisionMutation.validateWorkflowYamlConfigAsync(graphqlClient, {
        appId: projectId,
        yamlConfig,
      });
    } catch (error) {
      if (error instanceof CombinedError) {
        WorkflowFile.maybePrintWorkflowFileValidationErrors({
          error,
          accountName: account.name,
          projectName,
        });

        throw error;
      }
    }

    let projectArchiveBucketKey: string;
    let easJsonBucketKey: string | null = null;
    let packageJsonBucketKey: string | null = null;

    const easJsonPath = path.join(projectDir, 'eas.json');
    const packageJsonPath = path.join(projectDir, 'package.json');

    try {
      ({ projectArchiveBucketKey } = await uploadAccountScopedProjectSourceAsync({
        graphqlClient,
        vcsClient,
        accountId: account.id,
      }));

      if (await fileExistsAsync(easJsonPath)) {
        ({ fileBucketKey: easJsonBucketKey } = await uploadAccountScopedFileAsync({
          graphqlClient,
          accountId: account.id,
          filePath: easJsonPath,
          maxSizeBytes: 1024 * 1024,
        }));
      } else {
        Log.warn(
          `⚠ No ${chalk.bold('eas.json')} found in the project directory. Running ${chalk.bold(
            'type: build'
          )} jobs will not work. Run ${chalk.bold(
            'eas build:configure'
          )} to configure your project for builds.`
        );
      }

      if (await fileExistsAsync(packageJsonPath)) {
        ({ fileBucketKey: packageJsonBucketKey } = await uploadAccountScopedFileAsync({
          graphqlClient,
          accountId: account.id,
          filePath: packageJsonPath,
          maxSizeBytes: 1024 * 1024,
        }));
      } else {
        Log.warn(
          `⚠ No ${chalk.bold(
            'package.json'
          )} found in the project directory. It is used to automatically infer best job configuration for your project. You may want to define ${chalk.bold(
            'image'
          )} property in your workflow to specify the image to use.`
        );
      }
    } catch (err) {
      Log.error('Failed to upload project sources.');

      throw err;
    }

    let workflowRunId: string;

    try {
      ({ id: workflowRunId } = await WorkflowRunMutation.createWorkflowRunAsync(graphqlClient, {
        appId: projectId,
        workflowRevisionInput: {
          fileName: path.basename(args.file),
          yamlConfig,
        },
        workflowRunInput: {
          projectSource: {
            type: WorkflowProjectSourceType.Gcs,
            projectArchiveBucketKey,
            easJsonBucketKey,
            packageJsonBucketKey,
          },
        },
      }));

      Log.newLine();
      Log.log(`See logs: ${link(getWorkflowRunUrl(account.name, projectName, workflowRunId))}`);
    } catch (err) {
      Log.error('Failed to start the workflow with the API.');

      throw err;
    }

    if (!flags.wait) {
      Log.succeed('Workflow run started successfully.');

      if (flags.json) {
        printJsonOnlyOutput({
          id: workflowRunId,
          url: getWorkflowRunUrl(account.name, projectName, workflowRunId),
        });
      }

      process.exit(0);
    }

    Log.newLine();
    const { status } = await waitForWorkflowRunToEndAsync(graphqlClient, {
      workflowRunId,
    });

    if (flags.json) {
      const workflowRun = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, workflowRunId, {
        useCache: false,
      });

      printJsonOnlyOutput({
        ...workflowRun,
        url: getWorkflowRunUrl(account.name, projectName, workflowRunId),
      });
    }

    if (status === WorkflowRunStatus.Failure) {
      process.exit(EXIT_CODES.WORKFLOW_FAILED);
    } else if (status === WorkflowRunStatus.Canceled) {
      process.exit(EXIT_CODES.WORKFLOW_CANCELED);
    }
  }
}

async function waitForWorkflowRunToEndAsync(
  graphqlClient: ExpoGraphqlClient,
  { workflowRunId }: { workflowRunId: string }
): Promise<WorkflowRunByIdQuery['workflowRuns']['byId']> {
  Log.log('Waiting for workflow run to complete. You can press Ctrl+C to exit.');

  const spinner = ora('Currently waiting for workflow run to start.').start();

  let failedFetchesCount = 0;

  while (true) {
    try {
      const workflowRun = await WorkflowRunQuery.byIdAsync(graphqlClient, workflowRunId, {
        useCache: false,
      });

      failedFetchesCount = 0;

      switch (workflowRun.status) {
        case WorkflowRunStatus.InProgress:
          spinner.start('Workflow run is in progress.');
          break;

        case WorkflowRunStatus.ActionRequired:
          spinner.warn('Workflow run is waiting for action.');
          break;

        case WorkflowRunStatus.PendingCancel:
        case WorkflowRunStatus.Canceled:
          spinner.warn('Workflow run has been canceled.');
          return workflowRun;

        case WorkflowRunStatus.Failure:
          spinner.fail('Workflow run has failed.');
          return workflowRun;
        case WorkflowRunStatus.Success:
          spinner.succeed('Workflow run completed successfully.');
          return workflowRun;
      }
    } catch {
      spinner.text = '⚠ Failed to fetch the workflow run status. Check your network connection.';

      failedFetchesCount += 1;

      if (failedFetchesCount > 6) {
        spinner.fail('Failed to fetch the workflow run status 6 times in a row. Aborting wait.');
        process.exit(EXIT_CODES.WAIT_ABORTED);
      }
    }

    await sleepAsync(10 /* seconds */ * 1000 /* milliseconds */);
  }
}

async function fileExistsAsync(filePath: string): Promise<boolean> {
  return await fs.promises
    .access(filePath, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false);
}
