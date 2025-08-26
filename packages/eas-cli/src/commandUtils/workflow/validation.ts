import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { InvalidEasJsonError, MissingEasJsonError } from '@expo/eas-json/build/errors';
import { CombinedError } from '@urql/core';
import Ajv, { DefinedError } from 'ajv';
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
  const parsedYaml = parsedYamlFromWorkflowContents(workflowFileContents);

  // Check if the parsed result is empty or null
  validateWorkflowIsNotEmpty(parsedYaml);

  const workflowSchema = await fetchWorkflowSchemaAsync();

  // Check that result passes validation against workflow schema
  validateWorkflowStructure(parsedYaml, workflowSchema);

  // Check that all job types are valid
  validateWorkflowJobTypes(parsedYaml, workflowSchema);

  // Check for build jobs that do not match any EAS build profiles
  await validateWorkflowBuildJobsAsync(parsedYaml, projectDir);

  // Check for other errors using the server-side validation
  await validateWorkflowOnServerAsync(graphqlClient, projectId, workflowFileContents);
}

export function logWorkflowValidationErrors(
  error: unknown,
  account: AccountFragment | undefined,
  projectName: string | undefined
): void {
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
      accountName: account?.name ?? '',
      projectName: projectName ?? '',
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
  const buildJobs = jobs.filter(job => job.value.type === 'build');
  if (buildJobs.length === 0) {
    return;
  }
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);

  const buildProfileNames = new Set(
    easJsonAccessor && (await EasJsonUtils.getBuildProfileNamesAsync(easJsonAccessor))
  );
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

function validateWorkflowJobTypes(parsedYaml: any, workflowJsonSchema: any): void {
  const jobs = jobsFromWorkflow(parsedYaml);
  const jobTypes = jobTypesFromWorkflowSchema(workflowJsonSchema);
  const invalidJobs = jobs.filter(job => !jobTypes.includes(job.value.type));
  if (invalidJobs.length > 0) {
    throw new Error(
      `The following jobs have invalid types: ${invalidJobs
        .map(job => job.key)
        .join(', ')}. Valid types are: ${jobTypes.join(', ')}`
    );
  }
}

function validateWorkflowStructure(parsedYaml: any, workflowJsonSchema: any): void {
  const ajv = new Ajv({ allowUnionTypes: true });
  ajv.addKeyword('markdownDescription');
  ajv.addFormat('uri', {
    type: 'string',
    validate: (value: string) => {
      try {
        // eslint-disable-next-line no-new
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
  });
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
    const processedErrors = new Set<string>();
    for (const err of validate.errors ?? ([] as DefinedError[])) {
      if (err.message) {
        const params = new Map(Object.entries(err.params));
        for (const [key, value] of params) {
          if (key === 'allowedValue') {
            processedErrors.add(
              err?.instancePath +
                ' ' +
                err?.message?.replace('must be equal to constant', `must be equal to "${value}"`)
            );
          } else {
            processedErrors.add(err?.instancePath + ' ' + err?.message);
          }
        }
      }
    }
    throw new Error([...processedErrors].join('\n'));
  }
}

function parsedYamlFromWorkflowContents(workflowFileContents: {
  yamlConfig: string;
}): Promise<any> {
  const parsedYaml = YAML.parse(workflowFileContents.yamlConfig);
  return parsedYaml;
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function fetchWorkflowSchemaAsync(): Promise<any> {
  const response = await fetch('https://api.expo.dev/v2/workflows/schema');
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
