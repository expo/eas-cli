import { Command, flags } from '@oclif/command';
import pick from 'lodash/pick';
import ora from 'ora';

import { WebhookType } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery';
import { ensureLoggedInAsync } from '../../user/actions';
import { prepareInputParamsAsync } from '../../webhooks/input';

export default class WebhookUpdate extends Command {
  static description = 'Create a webhook on the current project.';

  static flags = {
    id: flags.string({
      description: 'Webhook ID',
      required: true,
    }),
    event: flags.enum({
      description: 'Event type that triggers the webhook',
      options: [WebhookType.Build],
      default: WebhookType.Build,
    }),
    url: flags.string({
      description: 'Webhook URL',
    }),
    secret: flags.string({
      description:
        "Secret used to create a hash signature of the request payload, provided in the 'Expo-Signature' header.",
    }),
  };

  async run() {
    await ensureLoggedInAsync();
    const { flags } = this.parse(WebhookUpdate);

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
