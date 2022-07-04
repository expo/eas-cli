import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand.js';
import { WebhookType } from '../../graphql/generated.js';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation.js';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery.js';
import { ora } from '../../ora.js';
import pick from '../../utils/expodash/pick.js';
import { prepareInputParamsAsync } from '../../webhooks/input.js';

export default class WebhookUpdate extends EasCommand {
  static description = 'update a webhook';

  static flags = {
    id: Flags.string({
      description: 'Webhook ID',
      required: true,
    }),
    event: Flags.enum({
      description: 'Event type that triggers the webhook',
      options: [WebhookType.Build, WebhookType.Submit],
    }),
    url: Flags.string({
      description: 'Webhook URL',
    }),
    secret: Flags.string({
      description:
        "Secret used to create a hash signature of the request payload, provided in the 'Expo-Signature' header.",
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(WebhookUpdate);

    const webhookId = flags.id;

    const webhook = await WebhookQuery.byIdAsync(webhookId);
    const webhookInputParams = await prepareInputParamsAsync(
      pick(flags, ['event', 'url', 'secret']),
      webhook
    );

    const spinner = ora('Updating a webhook').start();
    try {
      await WebhookMutation.updateWebhookAsync(webhookId, webhookInputParams);
      spinner.succeed('Successfully updated a webhook');
    } catch (err) {
      spinner.fail('Failed to update a webhook');
      throw err;
    }
  }
}
