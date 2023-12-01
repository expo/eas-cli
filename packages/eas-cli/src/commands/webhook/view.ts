import EasCommand from '../../commandUtils/EasCommand';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { formatWebhook } from '../../webhooks/formatWebhook';

export default class WebhookView extends EasCommand {
  static override description = 'view a webhook';

  static override args = [
    {
      name: 'ID',
      required: true,
      description: 'ID of the webhook to view',
    },
  ];

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { ID: webhookId },
    } = await this.parse(WebhookView);
    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WebhookView, { nonInteractive: true });

    const spinner = ora(`Fetching the webhook details for ID ${webhookId}`).start();
    try {
      const webhook = await WebhookQuery.byIdAsync(graphqlClient, webhookId);
      spinner.succeed(`Found the webhook details`);
      Log.log(`\n${formatWebhook(webhook)}`);
    } catch (err) {
      spinner.fail(`Couldn't find the webhook with ID ${webhookId}`);
      throw err;
    }
  }
}
