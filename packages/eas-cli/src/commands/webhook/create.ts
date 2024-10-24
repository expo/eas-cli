import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { WebhookType } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import { ora } from '../../ora';
import { prepareInputParamsAsync } from '../../webhooks/input';

export default class WebhookCreate extends EasCommand {
  static override description = 'create a webhook';

  static override flags = {
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
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(WebhookCreate);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WebhookCreate, {
      nonInteractive: flags['non-interactive'],
    });
    const webhookInputParams = await prepareInputParamsAsync(flags);

    const spinner = ora('Creating a webhook').start();
    try {
      await WebhookMutation.createWebhookAsync(graphqlClient, projectId, webhookInputParams);
      spinner.succeed('Successfully created a webhook');
    } catch (err) {
      spinner.fail('Failed to create a webhook');
      throw err;
    }
  }
}
