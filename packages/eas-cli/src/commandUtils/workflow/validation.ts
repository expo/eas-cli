import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { CombinedError } from '@urql/core';
import * as YAML from 'yaml';

import { AccountFragment } from '../../graphql/generated';
import { WorkflowRevisionMutation } from '../../graphql/mutations/WorkflowRevisionMutation';
import Log from '../../log';
import { WorkflowFile } from '../../utils/workflowFile';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

export async function validateWorkflowFileAsync(
  workflowFileContents: { yamlConfig: string; filePath: string },
  projectDir: string,
  graphqlClient: ExpoGraphqlClient,
  projectId: string
): Promise<void> {
  const parsedYaml = await parsedYamlFromWorkflowContentsAsync(workflowFileContents);

  // Check if the parsed result is empty or null
  validateWorkflowIsNotEmpty(parsedYaml);

  // Check for build jobs that do not match any EAS build profiles
  await validateWorkflowBuildJobsAsync(parsedYaml, projectDir);

  // Check for other errors using the server-side validation
  await validateWorkflowOnServerAsync(graphqlClient, projectId, workflowFileContents);
}
function validateWorkflowIsNotEmpty(parsedYaml: any): void {
  if (
    parsedYaml === null ||
    parsedYaml === undefined ||
    (typeof parsedYaml === 'object' && Object.keys(parsedYaml).length === 0)
  ) {
    throw new Error('YAML file is empty or contains only comments.');
  }
}

export function logWorkflowValidationErrors(
  error: unknown,
  account: AccountFragment,
  projectName: string
): void {
  if (error instanceof YAML.YAMLParseError) {
    Log.error(`YAML syntax error: ${error.message}`);
  } else if (error instanceof CombinedError) {
    WorkflowFile.maybePrintWorkflowFileValidationErrors({
      error,
      accountName: account.name,
      projectName,
    });

    throw error;
  } else if (error instanceof Error) {
    Log.error(error.message);
  } else {
    Log.error(`Unexpected error: ${String(error)}`);
  }
}

async function validateWorkflowOnServerAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  workflowFileContents: { yamlConfig: string }
): Promise<void> {
  await WorkflowRevisionMutation.validateWorkflowYamlConfigAsync(graphqlClient, {
    appId: projectId,
    yamlConfig: workflowFileContents.yamlConfig,
  });
}

async function parsedYamlFromWorkflowContentsAsync(workflowFileContents: {
  yamlConfig: string;
}): Promise<any> {
  const workflowSchema = await fetchWorkflowSchemaAsync();
  const customSchema = new YAML.Schema({ schema: workflowSchema, merge: true });
  const parsedYaml = YAML.parse(workflowFileContents.yamlConfig, {
    schema: customSchema,
    strict: true,
  });
  return parsedYaml;
}

async function validateWorkflowBuildJobsAsync(parsedYaml: any, projectDir: string): Promise<void> {
  const jobs = Object.entries(parsedYaml?.jobs).flatMap(([key, value]: [string, any]) => {
    return {
      key,
      value,
    };
  });
  const buildJobs = jobs.filter(job => job.value.type === 'build');
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  const buildProfileNames = new Set(await EasJsonUtils.getBuildProfileNamesAsync(easJsonAccessor));
  const invalidBuildJobs = buildJobs.filter(
    job => !buildProfileNames.has(job.value.params.profile)
  );
  if (invalidBuildJobs.length > 0) {
    throw new Error(
      `The following build jobs do not match any EAS build profiles: ${invalidBuildJobs
        .map(job => job.key)
        .join(', ')}`
    );
  }
}

async function fetchWorkflowSchemaAsync(): Promise<YAML.Schema> {
  const response = await fetch('https://api.expo.dev/v2/workflows/schema');
  if (!response.ok) {
    throw new Error(`Unable to fetch EAS Workflow schema, received status: ${response.status}`);
  }

  return (await response.json()) as YAML.Schema;
}
