/**
 * EAS Workflow Run Command
 *
 * This command runs an EAS workflow with support for interactive input prompting.
 *
 * Input Sources (in order of precedence):
 * 1. Command line flags (-F key=value)
 * 2. STDIN JSON input (echo '{"key": "value"}' | eas workflow:run)
 * 3. Interactive prompts (when required inputs are missing and not in non-interactive mode)
 *
 * Interactive Prompting:
 * - When running in interactive mode (default), the command will automatically prompt
 *   for any required inputs that are not provided via flags or STDIN
 * - Input types supported: string, boolean, number, choice, environment
 * - Each input type has appropriate validation and default values
 * - Use --non-interactive flag to disable prompting and require all inputs via flags
 *
 * Example workflow with inputs:
 * ```yaml
 * on:
 *   workflow_dispatch:
 *     inputs:
 *       environment:
 *         type: string
 *         required: true
 *         description: "Environment to deploy to"
 *       debug:
 *         type: boolean
 *         default: false
 *         description: "Enable debug mode"
 *       version:
 *         type: number
 *         required: true
 *         description: "Version number"
 *       deployment_type:
 *         type: choice
 *         options: ["staging", "production"]
 *         default: "staging"
 *         description: "Type of deployment"
 * ```
 */

import spawnAsync from '@expo/spawn-async';
import { Flags } from '@oclif/core';
import { CombinedError } from '@urql/core';
import chalk from 'chalk';
import * as path from 'node:path';
import slash from 'slash';

import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  maybePromptForMissingInputsAsync,
  parseInputs,
  parseJsonInputs,
  parseWorkflowInputsFromYaml,
} from '../../commandUtils/workflow/inputs';
import {
  fileExistsAsync,
  infoForActiveWorkflowRunAsync,
  infoForFailedWorkflowRunAsync,
  maybeReadStdinAsync,
} from '../../commandUtils/workflow/utils';
import {
  WorkflowProjectSourceType,
  WorkflowRevision,
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
  static override description =
    'run an EAS workflow. The entire local project directory will be packaged and uploaded to EAS servers for the workflow run, unless the --ref flag is used.';

  static override args = [{ name: 'file', description: 'Path to the workflow file to run' }];

  static override flags = {
    ...EASNonInteractiveFlag,
    wait: Flags.boolean({
      default: false,
      allowNo: true,
      description: 'Exit codes: 0 = success, 11 = failure, 12 = canceled, 13 = wait aborted.',
      summary:
        'Wait for workflow run to complete. Defaults to false. Cannot be used with the --json flag.',
    }),
    input: Flags.string({
      char: 'F',
      aliases: ['f', 'field'],
      multiple: true,
      description:
        'Add a parameter in key=value format. Use multiple instances of this flag to set multiple inputs.',
      summary: 'Set workflow inputs',
    }),
    ref: Flags.string({
      description:
        "The git reference must exist in the project's git repository, and the workflow file must exist at that reference. When this flag is used, the local project is not uploaded; instead, the workflow is run from the exact state of the project at the chosen reference.",
      summary: 'Git reference to run the workflow on',
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
      if (flags.wait) {
        throw new Error('Cannot use --json and --wait flags simultaneously.');
      }
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

    const {
      projectId,
      exp: { slug: projectName },
    } = await getDynamicPrivateProjectConfigAsync();
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    let yamlConfig: string;
    let workflowRunId: string;
    let workflowRevisionId: string | undefined;
    let gitRef: string | undefined;

    if (flags.ref) {
      // Run from git ref
      const fileName = path.basename(args.file);
      // Find the real commit, make sure the ref is valid
      gitRef = (
        await spawnAsync('git', ['rev-parse', flags.ref], {
          cwd: projectDir,
        })
      ).output[0].trim();
      if (!gitRef) {
        throw new Error('Failed to resolve git reference');
      }
      Log.log(`Using workflow file ${fileName} at ${gitRef}`);
      let revisionResult: WorkflowRevision | undefined;
      try {
        revisionResult = await WorkflowRevisionMutation.getOrCreateWorkflowRevisionFromGitRefAsync(
          graphqlClient,
          {
            appId: projectId,
            fileName,
            gitRef,
          }
        );
      } catch (err) {
        throw new Error(
          `Failed to find or create workflow revision for ${fileName} at ${flags.ref}: ${err}`
        );
      }
      Log.debug(`Workflow revision: ${JSON.stringify(revisionResult, null, 2)}`);
      if (!revisionResult) {
        throw new Error(
          `Failed to find or create workflow revision for ${fileName} at ${flags.ref}`
        );
      }
      yamlConfig = revisionResult.yamlConfig;
      workflowRevisionId = revisionResult.id;
    } else {
      // Run from local file
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
    }

    // Validate workflow YAML
    try {
      await WorkflowRevisionMutation.validateWorkflowYamlConfigAsync(graphqlClient, {
        appId: projectId,
        yamlConfig,
      });
    } catch (error) {
      if (error instanceof CombinedError) {
        WorkflowFile.maybePrintWorkflowFileValidationErrors({
          error,
        });

        throw error;
      }
    }

    let inputs: Record<string, unknown> | undefined;

    // Check for stdin input
    const stdinData = await maybeReadStdinAsync();

    const inputsFromFlags = [...(flags.input ?? [])];

    // Validate that both stdin and -F flags are not provided simultaneously
    if (stdinData && inputsFromFlags.length > 0) {
      throw new Error(
        'Cannot use both stdin JSON input and -F flags simultaneously. Please use only one input method.'
      );
    }

    if (stdinData) {
      inputs = parseJsonInputs(stdinData);
    } else if (inputsFromFlags.length > 0) {
      inputs = parseInputs(inputsFromFlags);
    }

    // Parse workflow inputs from YAML and prompt for missing required inputs
    const inputSpecs = parseWorkflowInputsFromYaml(yamlConfig);
    if (!flags['non-interactive']) {
      inputs = await maybePromptForMissingInputsAsync({ inputSpecs, inputs: inputs ?? {} });
    }

    if (inputs && Object.keys(inputs).length > 0) {
      Log.addNewLineIfNone();
      Log.newLine();
      Log.log('Running with inputs:');
      for (const [key, value] of Object.entries(inputs)) {
        Log.log(`- ${chalk.bold(key)}: ${JSON.stringify(value)}`);
      }
    }

    let projectArchiveBucketKey: string;
    let easJsonBucketKey: string | null = null;
    let packageJsonBucketKey: string | null = null;

    const easJsonPath = path.join(projectDir, 'eas.json');
    const packageJsonPath = path.join(projectDir, 'package.json');

    const projectRootDirectory = slash(
      path.relative(await vcsClient.getRootPathAsync(), projectDir) || '.'
    );

    if (gitRef) {
      // Run from git ref
      let runResult: { id: string };
      try {
        runResult = await WorkflowRunMutation.createWorkflowRunFromGitRefAsync(graphqlClient, {
          workflowRevisionId: workflowRevisionId ?? '',
          gitRef,
          inputs,
        });
      } catch (err) {
        throw new Error(`Failed to create workflow run: ${err}`);
      }
      workflowRunId = runResult.id;
    } else {
      // Run from local file
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

      try {
        ({ id: workflowRunId } = await WorkflowRunMutation.createWorkflowRunAsync(graphqlClient, {
          appId: projectId,
          workflowRevisionInput: {
            fileName: path.basename(args.file),
            yamlConfig,
          },
          workflowRunInput: {
            inputs,
            projectSource: {
              type: WorkflowProjectSourceType.Gcs,
              projectArchiveBucketKey,
              easJsonBucketKey,
              packageJsonBucketKey,
              projectRootDirectory,
            },
          },
        }));
      } catch (err) {
        Log.error('Failed to start the workflow with the API.');

        throw err;
      }
    }

    Log.newLine();
    Log.log(`See logs: ${link(getWorkflowRunUrl(account.name, projectName, workflowRunId))}`);

    if (!flags.wait) {
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

  const spinner = ora('').start();
  spinner.prefixText = chalk`{bold.yellow Workflow run is waiting to start:}`;

  let failedFetchesCount = 0;

  while (true) {
    try {
      const workflowRun = await WorkflowRunQuery.withJobsByIdAsync(graphqlClient, workflowRunId, {
        useCache: false,
      });

      failedFetchesCount = 0;

      switch (workflowRun.status) {
        case WorkflowRunStatus.New:
          break;
        case WorkflowRunStatus.InProgress: {
          spinner.prefixText = chalk`{bold.green Workflow run is in progress:}`;
          spinner.text = await infoForActiveWorkflowRunAsync(graphqlClient, workflowRun, 5);
          break;
        }
        case WorkflowRunStatus.ActionRequired:
          spinner.prefixText = chalk`{bold.yellow Workflow run is waiting for action:}`;
          break;

        case WorkflowRunStatus.Canceled:
          spinner.prefixText = chalk`{bold.yellow Workflow has been canceled.}`;
          spinner.stopAndPersist();
          return workflowRun;

        case WorkflowRunStatus.Failure: {
          spinner.prefixText = chalk`{bold.red Workflow has failed.}`;
          const failedInfo = await infoForFailedWorkflowRunAsync(graphqlClient, workflowRun);
          spinner.fail(failedInfo);
          return workflowRun;
        }
        case WorkflowRunStatus.Success:
          spinner.prefixText = chalk`{bold.green Workflow has completed successfully.}`;
          spinner.succeed('');
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
