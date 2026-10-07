import { ExpoGraphqlClient } from '../../context/contextUtils/createGraphqlClient';
import { buildProfileNamesFromProjectAsync } from '../buildProfileUtils';
import { validateWorkflowFileAsync, validateWorkflowStructure } from '../validation';

jest.mock('../buildProfileUtils');
jest.mock('../compositeFunctions');
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

const buildJobVariant = {
  type: 'object',
  properties: {
    type: { const: 'build' },
    params: {
      type: 'object',
      properties: { platform: { type: 'string' }, profile: { type: 'string' } },
      required: ['platform'],
    },
  },
  required: ['type', 'params'],
};

const repackJobVariant = {
  type: 'object',
  properties: {
    type: { const: 'repack' },
    needs: { type: 'array', items: { type: 'string' } },
    params: {
      type: 'object',
      properties: { build_id: { type: 'string' }, profile: { type: 'string' } },
      required: ['build_id'],
    },
  },
  required: ['type', 'params'],
};

// Calls a reusable workflow; it has no `type`, unlike every other job variant.
const reusableWorkflowCallVariant = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    if: { type: 'string' },
    needs: { type: 'array', items: { type: 'string' } },
    after: { type: 'array', items: { type: 'string' } },
    uses: { type: 'string' },
    with: { type: 'object' },
  },
  required: ['uses'],
  additionalProperties: false,
};

const schemaWithJobVariants = (variants: object[]): object => ({
  data: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      jobs: { type: 'object', additionalProperties: { anyOf: variants } },
    },
    required: ['jobs'],
  },
});

describe(validateWorkflowFileAsync, () => {
  const fetchSpy = jest.spyOn(global, 'fetch');

  const mockSchema = (variants: object[]): void => {
    fetchSpy.mockImplementation(
      async () => new Response(JSON.stringify(schemaWithJobVariants(variants)), { status: 200 })
    );
  };

  const validateAsync = (yamlConfig: string): Promise<void> =>
    validateWorkflowFileAsync(
      { yamlConfig, filePath: '.eas/workflows/test.yml' },
      '/project',
      {} as ExpoGraphqlClient,
      'project-id'
    );

  const initialSchemaPath = process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH;

  beforeEach(() => {
    delete process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH;
    jest.mocked(buildProfileNamesFromProjectAsync).mockResolvedValue(new Set(['production']));
  });

  afterAll(() => {
    process.env.EXPO_TESTING_WORKFLOW_SCHEMA_PATH = initialSchemaPath;
    fetchSpy.mockRestore();
  });

  it('validates typed jobs when the schema has a job variant without a type', async () => {
    mockSchema([buildJobVariant, reusableWorkflowCallVariant]);

    await expect(
      validateAsync(`
jobs:
  build_ios:
    type: build
    params:
      platform: ios
      profile: production
`)
    ).resolves.toBeUndefined();
  });

  it('validates a job that calls a reusable workflow', async () => {
    mockSchema([buildJobVariant, reusableWorkflowCallVariant]);

    await expect(
      validateAsync(`
jobs:
  shared:
    uses: ./.eas/workflows/shared.yml
`)
    ).resolves.toBeUndefined();
  });

  it('lists only typed job variants when a job type is invalid', async () => {
    mockSchema([buildJobVariant, reusableWorkflowCallVariant, repackJobVariant]);

    await expect(
      validateAsync(`
jobs:
  oops:
    type: not-a-job-type
`)
    ).rejects.toThrow(
      'The following jobs have invalid types: oops. Valid types are: build, repack'
    );
  });

  it('accepts a repack job that sets only build_id', async () => {
    mockSchema([buildJobVariant, repackJobVariant]);

    await expect(
      validateAsync(`
jobs:
  build_android:
    type: build
    params:
      platform: android
      profile: production
  repack_android:
    type: repack
    needs: [build_android]
    params:
      build_id: \${{ needs.build_android.outputs.build_id }}
`)
    ).resolves.toBeUndefined();
  });

  it('falls back to schema validation when the schema lists no job types', async () => {
    mockSchema([reusableWorkflowCallVariant]);

    await expect(
      validateAsync(`
jobs:
  build_ios:
    type: build
`)
    ).rejects.toThrow("The value at /jobs/build_ios is missing the required field 'uses'.");
  });

  it('still rejects a repack job whose profile is not in eas.json', async () => {
    mockSchema([repackJobVariant]);

    await expect(
      validateAsync(`
jobs:
  repack_android:
    type: repack
    params:
      build_id: abc
      profile: missing
`)
    ).rejects.toThrow(
      'The build jobs in this workflow refer to the following build profiles that are not present in your eas.json file: missing'
    );
  });
});
