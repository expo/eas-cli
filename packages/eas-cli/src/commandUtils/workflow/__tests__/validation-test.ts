import { vol } from 'memfs';

import { WorkflowRevisionMutation } from '../../../graphql/mutations/WorkflowRevisionMutation';
import { ExpoGraphqlClient } from '../../context/contextUtils/createGraphqlClient';
import { validateWorkflowFileAsync, validateWorkflowStructure } from '../validation';

jest.mock('fs');
jest.mock('../../../graphql/mutations/WorkflowRevisionMutation');

const workflowSchema = {
  type: 'object',
  properties: {
    jobs: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'slack' },
              params: {
                type: 'object',
                properties: {
                  webhook_url: { type: 'string', format: 'uri' },
                  message: { type: 'string' },
                },
                required: ['webhook_url', 'message'],
                additionalProperties: false,
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
  additionalProperties: false,
};

const workflowWithWebhookUrl = (webhookUrl: string): object => ({
  jobs: {
    notify: {
      type: 'slack',
      params: {
        webhook_url: webhookUrl,
        message: 'Build finished',
      },
    },
  },
});

describe(validateWorkflowStructure, () => {
  it('allows interpolated values for URI fields', () => {
    expect(() => {
      validateWorkflowStructure(
        workflowWithWebhookUrl('${{ env.SLACK_WEBHOOK_URL }}'),
        workflowSchema
      );
    }).not.toThrow();
  });

  it('still rejects invalid literal values for URI fields', () => {
    expect(() => {
      validateWorkflowStructure(workflowWithWebhookUrl('not a URL'), workflowSchema);
    }).toThrow('must be a valid URI string');
  });
});

const schemaWithUsesJob = {
  type: 'object',
  properties: {
    jobs: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'slack' },
              params: { type: 'object' },
            },
            required: ['type', 'params'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              uses: { type: 'string' },
              with: { type: 'object' },
            },
            required: ['uses'],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ['jobs'],
  additionalProperties: false,
};

describe(validateWorkflowFileAsync, () => {
  const schemaPath = '/schema.json';
  const graphqlClient = {} as ExpoGraphqlClient;

  beforeEach(() => {
    vol.reset();
    vol.fromJSON({ [schemaPath]: JSON.stringify({ data: schemaWithUsesJob }) });
    process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH = schemaPath;
    jest.mocked(WorkflowRevisionMutation.validateWorkflowYamlConfigAsync).mockResolvedValue();
  });

  afterEach(() => {
    delete process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH;
  });

  const validateAsync = (yamlConfig: string): Promise<void> =>
    validateWorkflowFileAsync(
      { yamlConfig, filePath: 'workflow.yml' },
      '/project',
      graphqlClient,
      'project-id'
    );

  it('accepts a valid workflow when the schema has a job entry without a type', async () => {
    await expect(
      validateAsync('jobs:\n  notify:\n    type: slack\n    params:\n      message: hi\n')
    ).resolves.toBeUndefined();
  });

  it('rejects unknown job types when the schema has a job entry without a type', async () => {
    await expect(validateAsync('jobs:\n  bad:\n    type: not-a-job\n')).rejects.toThrow(
      'The following jobs have invalid types: bad. Valid types are: slack'
    );
  });
});
