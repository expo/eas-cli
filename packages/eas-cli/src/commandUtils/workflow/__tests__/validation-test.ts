import { validateWorkflowStructure } from '../validation';

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
