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

import { Flags } from '@oclif/core';
import { CombinedError } from '@urql/core';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import slash from 'slash';
import * as YAML from 'yaml';
import { z } from 'zod';

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
import { promptAsync } from '../../prompts';
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
    input: Flags.string({
      char: 'F',
      aliases: ['f', 'field'],
      multiple: true,
      description:
        'Add a parameter in key=value format. Use multiple instances of this flag to set multiple inputs.',
      summary: 'Set workflow inputs',
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

    const projectRootDirectory = slash(
      path.relative(await vcsClient.getRootPathAsync(), projectDir) || '.'
    );

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

      Log.newLine();
      Log.log(`See logs: ${link(getWorkflowRunUrl(account.name, projectName, workflowRunId))}`);
    } catch (err) {
      Log.error('Failed to start the workflow with the API.');

      throw err;
    }

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

export function parseInputs(inputFlags: string[]): Record<string, string> {
  const inputs: Record<string, string> = {};

  for (const inputFlag of inputFlags) {
    const equalIndex = inputFlag.indexOf('=');
    if (equalIndex === -1) {
      throw new Error(`Invalid input format: ${inputFlag}. Expected key=value format.`);
    }

    const key = inputFlag.substring(0, equalIndex);
    const value = inputFlag.substring(equalIndex + 1);

    if (!key) {
      throw new Error(`Invalid input format: ${inputFlag}. Key cannot be empty.`);
    }

    inputs[key] = value;
  }

  return inputs;
}

export async function maybeReadStdinAsync(): Promise<string | null> {
  // Check if there's data on stdin
  if (process.stdin.isTTY) {
    return null;
  }

  return await new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');

    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      const trimmedData = data.trim();
      resolve(trimmedData || null);
    });

    process.stdin.on('error', err => {
      reject(err);
    });
  });
}

export function parseJsonInputs(jsonString: string): Record<string, string> {
  try {
    const parsed = JSON.parse(jsonString);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('JSON input must be an object.');
    }

    return parsed;
  } catch (error) {
    throw new Error(`Invalid JSON input.`, { cause: error });
  }
}

// `z.coerce.boolean()` does `Boolean(val)` under the hood,
// which is not what we want. See:
// https://github.com/colinhacks/zod/issues/2985#issuecomment-2230692578
const booleanLike = z.union([
  z.boolean(),
  z.number().pipe(z.coerce.boolean()),
  z.preprocess(val => {
    if (typeof val === 'string') {
      if (val.toLowerCase() === 'true') {
        return true;
      }

      if (val.toLowerCase() === 'false') {
        return false;
      }
    }

    return val;
  }, z.boolean()),
]);

const stringLike = z
  .union([
    // We're going to coerce numbers and strings into strings.
    z.number(),
    z.string(),
    // We do not allow other primitives, like:
    // - bigints, symbols - because YAML does not support them,
    // - booleans - because YAML accepts `True` and `true` as boolean input
    //   and parses both as JS `true` -- if we stringified that,
    //   we would lose the capital "T" which may not be what the user expects,
    // - nulls - user should do `"null"` or not pass the property at all.
  ])
  .pipe(z.coerce.string());

export const WorkflowDispatchInputZ = z
  .object({
    description: stringLike.optional().describe('Description of the input'),
    required: booleanLike.default(false).describe('Whether the input is required'),
  })
  .and(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('string').default('string'),
        default: stringLike.optional().describe('Default value for the input'),
      }),
      z.object({
        type: z.literal('boolean'),
        default: booleanLike.optional().describe('Default value for the input'),
      }),
      z.object({
        type: z.literal('number'),
        default: z.number().optional().describe('Default value for the input'),
      }),
      z.object({
        type: z.literal('choice'),
        default: stringLike.optional().describe('Default value for the input'),
        options: z.array(stringLike).min(1).describe('Options for choice type inputs'),
      }),
      z.object({
        type: z.literal('environment'),
        default: z.string().optional().describe('Default value for the input'),
      }),
    ])
  );

export function parseWorkflowInputsFromYaml(
  yamlConfig: string
): Record<string, z.infer<typeof WorkflowDispatchInputZ>> {
  try {
    const parsed = YAML.parse(yamlConfig);
    return z
      .record(z.string(), WorkflowDispatchInputZ)
      .parse(parsed?.on?.workflow_dispatch?.inputs);
  } catch (error) {
    Log.warn('Failed to parse workflow inputs from YAML:', error);
    return {};
  }
}

async function maybePromptForMissingInputsAsync({
  inputSpecs,
  inputs,
}: {
  inputSpecs: Record<string, z.infer<typeof WorkflowDispatchInputZ>>;
  inputs: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const requiredInputs = Object.entries(inputSpecs).filter(([_, spec]) => spec.required);

  const missingRequiredInputs = requiredInputs.filter(([key]) => inputs[key] === undefined);

  if (missingRequiredInputs.length === 0) {
    return inputs;
  }

  Log.addNewLineIfNone();
  Log.log('Some required inputs are missing. Please provide them:');

  const nextInputs = { ...inputs };

  for (const [key, spec] of missingRequiredInputs) {
    const value = await promptForMissingInputAsync({ key, spec });
    nextInputs[key] = value;
  }

  return nextInputs;
}

async function promptForMissingInputAsync({
  key,
  spec,
}: {
  key: string;
  spec: z.infer<typeof WorkflowDispatchInputZ>;
}): Promise<unknown> {
  const message = spec.description ? `${key} (${spec.description})` : key;

  switch (spec.type) {
    case 'boolean': {
      const { value } = await promptAsync({
        type: 'confirm',
        name: 'value',
        message,
        initial: spec.default,
      });
      return value;
    }

    case 'number': {
      const { value } = await promptAsync({
        type: 'number',
        name: 'value',
        message,
        initial: spec.default,
        validate: (val: number) => {
          if (isNaN(val)) {
            return 'Please enter a valid number';
          }
          return true;
        },
      });
      return value;
    }

    case 'choice': {
      const { value } = await promptAsync({
        type: 'select',
        name: 'value',
        message,
        choices: spec.options.map(option => ({
          title: option,
          value: option,
        })),
        initial: spec.default,
      });
      return value;
    }

    case 'string':
    case 'environment': {
      const { value } = await promptAsync({
        type: 'text',
        name: 'value',
        message,
        initial: spec.default,
        validate: (val: string) => {
          if (spec.required && (!val || val.trim() === '')) {
            return 'This field is required';
          }
          return true;
        },
      });
      return value;
    }
  }
}
