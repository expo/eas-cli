import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { WebhookType } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery';
import { ora } from '../../ora';
import pick from '../../utils/expodash/pick';
import { prepareInputParamsAsync } from '../../webhooks/input';

export default class WebhookUpdate extends EasCommand {
  static override description = 'update a webhook';

  static override flags = {
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
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(WebhookUpdate);
    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WebhookUpdate, { nonInteractive: flags['non-interactive'] });

    const webhookId = flags.id;

    const webhook = await WebhookQuery.byIdAsync(graphqlClient, webhookId);
    const webhookInputParams = await prepareInputParamsAsync(
      pick(flags, ['event', 'url', 'secret', 'non-interactive']),
      webhook
    );

    const spinner = ora('Updating a webhook').start();
    try {
      await WebhookMutation.updateWebhookAsync(graphqlClient, webhookId, webhookInputParams);
      spinner.succeed('Successfully updated a webhook');
    } catch (err) {
      spinner.fail('Failed to update a webhook');
      throw err;
    }
  }
}
