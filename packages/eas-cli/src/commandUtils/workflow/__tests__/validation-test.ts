import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { WorkflowRevisionMutation } from '../../../graphql/mutations/WorkflowRevisionMutation';
import { ExpoGraphqlClient } from '../../context/contextUtils/createGraphqlClient';
import { validateWorkflowFileAsync } from '../validation';

jest.mock('../../../graphql/mutations/WorkflowRevisionMutation');

const slackParamsSchema = (extraProperty: string, extraSchema: object): object => ({
  type: 'object',
  properties: {
    webhook_url: { type: 'string', format: 'uri' },
    [extraProperty]: extraSchema,
  },
  required: ['webhook_url', extraProperty],
  additionalProperties: false,
});

// Trimmed down from the schema served by <ApiBaseUrl>/v2/workflows/schema, keeping the parts
// that matter here: the `slack` job declares `webhook_url` with `format: uri`, and its params
// are an `anyOf` of two shapes, so a single format failure makes the whole job unmatchable.
const workflowSchemaResponse = {
  data: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      jobs: {
        type: 'object',
        propertyNames: { type: 'string' },
        additionalProperties: {
          anyOf: [
            {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'slack' },
                params: {
                  anyOf: [
                    slackParamsSchema('message', { type: 'string' }),
                    slackParamsSchema('payload', {
                      type: 'object',
                      properties: {},
                      additionalProperties: {},
                    }),
                  ],
                },
              },
              required: ['type', 'params'],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ['jobs'],
  },
};

function workflowWithWebhookUrl(webhookUrl: string): { yamlConfig: string; filePath: string } {
  return {
    yamlConfig: [
      'jobs:',
      '  notify:',
      '    type: slack',
      '    params:',
      `      webhook_url: "${webhookUrl}"`,
      '      message: Build finished',
    ].join('\n'),
    filePath: '.eas/workflows/notify.yml',
  };
}

describe('validateWorkflowFileAsync', () => {
  let projectDir: string;
  let previousSchemaPath: string | undefined;
  const graphqlClient = {} as ExpoGraphqlClient;

  beforeAll(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-validation-test-'));
    const schemaPath = path.join(projectDir, 'workflow-schema.json');
    await fs.writeFile(schemaPath, JSON.stringify(workflowSchemaResponse), 'utf-8');
    previousSchemaPath = process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH;
    process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH = schemaPath;
  });

  afterAll(async () => {
    if (previousSchemaPath === undefined) {
      delete process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH;
    } else {
      process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH = previousSchemaPath;
    }
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.mocked(WorkflowRevisionMutation.validateWorkflowYamlConfigAsync).mockResolvedValue();
  });

  it('accepts a formatted value that is a template expression', async () => {
    await expect(
      validateWorkflowFileAsync(
        workflowWithWebhookUrl('${{ env.SLACK_WEBHOOK_URL }}'),
        projectDir,
        graphqlClient,
        'test-project-id'
      )
    ).resolves.toBeUndefined();
  });

  it('accepts a formatted value that is partially interpolated', async () => {
    await expect(
      validateWorkflowFileAsync(
        workflowWithWebhookUrl('https://hooks.slack.com/services/${{ env.SLACK_HOOK_PATH }}'),
        projectDir,
        graphqlClient,
        'test-project-id'
      )
    ).resolves.toBeUndefined();
  });

  it('accepts a formatted value that is a valid literal', async () => {
    await expect(
      validateWorkflowFileAsync(
        workflowWithWebhookUrl('https://hooks.slack.com/services/T000/B000/XXXX'),
        projectDir,
        graphqlClient,
        'test-project-id'
      )
    ).resolves.toBeUndefined();
  });

  it('still rejects a formatted value that is a malformed literal', async () => {
    await expect(
      validateWorkflowFileAsync(
        workflowWithWebhookUrl('not a url'),
        projectDir,
        graphqlClient,
        'test-project-id'
      )
    ).rejects.toThrow(/webhook_url/);
  });
});
