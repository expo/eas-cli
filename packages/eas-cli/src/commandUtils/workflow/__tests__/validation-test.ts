import path from 'path';

import { ExpoGraphqlClient } from '../../context/contextUtils/createGraphqlClient';
import { validateWorkflowFileAsync } from '../validation';

jest.mock('../compositeFunctions', () => ({
  validateWorkflowLocalCompositeFunctionsAsync: jest.fn(),
}));
jest.mock('../buildProfileUtils', () => ({
  buildProfileNamesFromProjectAsync: jest.fn(async () => new Set(['production'])),
}));
jest.mock('../../../graphql/mutations/WorkflowRevisionMutation', () => ({
  WorkflowRevisionMutation: {
    validateWorkflowYamlConfigAsync: jest.fn(),
  },
}));

const SCHEMA_PATH = path.join(__dirname, 'fixtures', 'workflow-schema.json');

async function validateAsync(yamlConfig: string): Promise<void> {
  await validateWorkflowFileAsync(
    { yamlConfig, filePath: '.eas/workflows/test.yml' },
    '/project',
    {} as ExpoGraphqlClient,
    'projectId'
  );
}

function slackWorkflow(webhookUrl: string): string {
  return `
name: Notify
jobs:
  notify:
    name: Notify
    type: slack
    params:
      message: Build finished
      webhook_url: ${webhookUrl}
`;
}

describe(validateWorkflowFileAsync, () => {
  const originalSchemaPath = process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH;

  beforeAll(() => {
    process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH = SCHEMA_PATH;
  });

  afterAll(() => {
    process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH = originalSchemaPath;
  });

  it('accepts a value that only becomes a URI once the workflow runs', async () => {
    await expect(
      validateAsync(slackWorkflow('${{ env.SLACK_WEBHOOK_URL }}'))
    ).resolves.toBeUndefined();
  });

  it('accepts a URI written out in the file', async () => {
    await expect(
      validateAsync(slackWorkflow('https://hooks.slack.com/services/T000/B000/XXX'))
    ).resolves.toBeUndefined();
  });

  it('still rejects a value that is neither a URI nor an expression', async () => {
    await expect(validateAsync(slackWorkflow('"not a webhook"'))).rejects.toThrow(/webhook_url/);
  });
});
