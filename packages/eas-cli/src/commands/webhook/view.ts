import EasCommand from '../../commandUtils/EasCommand.js';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery.js';
import Log from '../../log.js';
import { ora } from '../../ora.js';
import { formatWebhook } from '../../webhooks/formatWebhook.js';

export default class WebhookView extends EasCommand {
  static description = 'view a webhook';

  static args = [
    {
      name: 'ID',
      required: true,
      description: 'ID of the webhook to view',
    },
  ];

  async runAsync(): Promise<void> {
    const {
      args: { ID: webhookId },
    } = await this.parse(WebhookView);

    const spinner = ora(`Fetching the webhook details for ID ${webhookId}`).start();
    try {
      const webhook = await WebhookQuery.byIdAsync(webhookId);
      spinner.succeed(`Found the webhook details`);
      Log.log(`\n${formatWebhook(webhook)}`);
    } catch (err) {
      spinner.fail(`Couldn't find the webhook with ID ${webhookId}`);
      throw err;
    }
  }
}
