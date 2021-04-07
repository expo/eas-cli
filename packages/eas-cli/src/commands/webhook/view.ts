import { Command } from '@oclif/command';
import ora from 'ora';

import { WebhookQuery } from '../../graphql/queries/WebhookQuery';
import Log from '../../log';
import { ensureLoggedInAsync } from '../../user/actions';
import { formatWebhook } from '../../webhooks/formatWebhook';

export default class WebhookView extends Command {
  static description = 'View a webhook on the current project.';

  static args = [
    {
      name: 'ID',
      required: true,
      description: 'ID of the webhook to view',
    },
  ];

  async run() {
    await ensureLoggedInAsync();
    const {
      args: { ID: webhookId },
    } = this.parse(WebhookView);

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
