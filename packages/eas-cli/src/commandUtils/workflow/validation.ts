import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { InvalidEasJsonError, MissingEasJsonError } from '@expo/eas-json/build/errors';
import { CombinedError } from '@urql/core';
import { promises as fs } from 'fs';
import path from 'path';
import * as YAML from 'yaml';

import { getExpoApiWorkflowSchemaURL } from '../../api';
import { WorkflowRevisionMutation } from '../../graphql/mutations/WorkflowRevisionMutation';
import Log from '../../log';
import { createValidator, getReadableErrors } from '../../metadata/utils/ajv';
import { WorkflowFile } from '../../utils/workflowFile';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

const jobTypesWithBuildProfile = new Set(['build', 'repack']);

const buildProfileIsInterpolated = (profileName: string): boolean => {
  return profileName.includes('${{') && profileName.includes('}}');
};

export async function validateWorkflowFileAsync(
  workflowFileContents: { yamlConfig: string; filePath: string },
  projectDir: string,
  graphqlClient: ExpoGraphqlClient,
  projectId: string
): Promise<void> {
  const parsedYaml = parsedYamlFromWorkflowContents(workflowFileContents);
  Log.debug(`Parsed workflow: ${JSON.stringify(parsedYaml, null, 2)}`);

  // Check if the parsed result is empty or null
  Log.debug(`Validating workflow is not empty...`);
  validateWorkflowIsNotEmpty(parsedYaml);

  const workflowSchema = await fetchWorkflowSchemaAsync();

  // Check that all job types are valid
  Log.debug(`Validating workflow job types...`);
  validateWorkflowJobTypes(parsedYaml, workflowSchema);

  // Check for build jobs that do not match any EAS build profiles
  Log.debug(`Validating workflow build jobs...`);
  await validateWorkflowBuildJobsAsync(parsedYaml, projectDir);

  // Check that result passes validation against workflow schema
  Log.debug(`Validating workflow structure...`);
  validateWorkflowStructure(parsedYaml, workflowSchema);

  // Check for other errors using the server-side validation
  Log.debug(`Validating workflow on server...`);
  await validateWorkflowOnServerAsync(graphqlClient, projectId, workflowFileContents);
}

export function logWorkflowValidationErrors(error: unknown): void {
  if (error instanceof MissingEasJsonError) {
    throw new Error(
      'Workflows require a valid eas.json. Please run "eas build:configure" to create it.'
    );
  } else if (error instanceof InvalidEasJsonError) {
    throw new Error(
      'Workflows require a valid eas.json. Please fix the errors in your eas.json and try again.\n\n' +
        error.message
    );
  } else if (error instanceof YAML.YAMLParseError) {
    Log.error(`YAML syntax error: ${error.message}`);
  } else if (error instanceof CombinedError) {
    WorkflowFile.maybePrintWorkflowFileValidationErrors({
      error,
    });

    throw error;
  } else if (error instanceof Error) {
    Log.error(`Error: ${error.message}`);
  } else {
    Log.error(`Unexpected error: ${String(error)}`);
  }
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

async function validateWorkflowBuildJobsAsync(parsedYaml: any, projectDir: string): Promise<void> {
  const jobs = jobsFromWorkflow(parsedYaml);
  const buildJobs = jobs.filter(job => jobTypesWithBuildProfile.has(job.value.type));
  if (buildJobs.length === 0) {
    return;
  }
  const buildProfileNames = await buildProfileNamesFromProjectAsync(projectDir);

  const invalidBuildJobs = buildJobs.filter(
    job =>
      !buildProfileNames.has(job.value.params.profile) &&
      // If a profile name is interpolated, we can't check if it's valid until the workflow actually runs
      !buildProfileIsInterpolated(job.value.params.profile)
  );

  if (invalidBuildJobs.length > 0) {
    const invalidBuildProfiles = new Set(invalidBuildJobs.map(job => job.value.params.profile));
    throw new Error(
      `The build jobs in this workflow refer to the following build profiles that are not present in your eas.json file: ${[
        ...invalidBuildProfiles,
      ].join(', ')}`
    );
  }
}

function validateWorkflowJobTypes(parsedYaml: any, workflowJsonSchema: any): void {
  const jobs = jobsFromWorkflow(parsedYaml);
  const jobTypes = jobTypesFromWorkflowSchema(workflowJsonSchema);
  const invalidJobs = jobs.filter(job => job.value.type && !jobTypes.includes(job.value.type));
  if (invalidJobs.length > 0) {
    throw new Error(
      `The following jobs have invalid types: ${invalidJobs
        .map(job => job.key)
        .join(', ')}. Valid types are: ${jobTypes.join(', ')}`
    );
  }
}

function validateWorkflowStructure(parsedYaml: any, workflowJsonSchema: any): void {
  delete workflowJsonSchema['$schema'];

  const ajv = createValidator();
  const validate = ajv.compile(workflowJsonSchema);
  const result = validate(parsedYaml);

  if (!result) {
    Log.debug(
      JSON.stringify(
        {
          errors: validate.errors,
        },
        null,
        2
      )
    );
    const readableErrors = getReadableErrors(validate.errors ?? []);
    const processedErrors = new Set<string>();
    for (const err of readableErrors) {
      if (err.message) {
        processedErrors.add(err.message);
      }
    }
    throw new Error([...processedErrors].join('\n'));
  }
}

export function parsedYamlFromWorkflowContents(workflowFileContents: { yamlConfig: string }): any {
  const parsedYaml = YAML.parse(workflowFileContents.yamlConfig);
  return parsedYaml;
}

export function workflowContentsFromParsedYaml(parsedYaml: any): string {
  return YAML.stringify(parsedYaml);
}

export async function buildProfileNamesFromProjectAsync(projectDir: string): Promise<Set<string>> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);

  const buildProfileNames = new Set(
    easJsonAccessor && (await EasJsonUtils.getBuildProfileNamesAsync(easJsonAccessor))
  );
  return buildProfileNames;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function fetchWorkflowSchemaAsync(): Promise<any> {
  // EXPO_TESTING_WORKFLOW_SCHEMA_PATH is used only for testing against a different schema
  if (process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH) {
    const schemaPath = path.resolve(process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH);
    Log.debug(`Loading workflow schema from ${schemaPath}`);
    const jsonString = await fs.readFile(schemaPath, 'utf-8');
    const jsonFromFile = JSON.parse(jsonString);
    return jsonFromFile.data;
  }
  // Otherwise, we fetch from <ApiBaseUrl>/v2/workflows/schema
  const schemaUrl = getExpoApiWorkflowSchemaURL();
  Log.debug(`Fetching workflow schema from ${schemaUrl}`);
  const response = await fetch(schemaUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch EAS Workflow schema, received status: ${response.status}`);
  }
  const jsonResponse: any = (await response.json()) as any;
  return jsonResponse.data;
}

function jobsFromWorkflow(parsedYaml: any): any[] {
  return Object.entries(parsedYaml?.jobs).flatMap(([key, value]: [string, any]) => {
    return {
      key,
      value,
    };
  });
}

function jobTypesFromWorkflowSchema(workflowJsonSchema: any): string[] {
  return workflowJsonSchema?.properties?.jobs?.additionalProperties?.anyOf.map(
    (props: any) => props.properties.type.const
  );
}
