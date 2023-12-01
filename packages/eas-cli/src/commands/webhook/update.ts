import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { WebhookType } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery';
import { ora } from '../../ora';
import pick from '../../utils/expodash/pick';
import { prepareInputParamsAsync } from '../../webhooks/input';
import { maybeGetWebhookType } from './create';

interface RawWebhookUpdateFlags {
  id: string;
  event?: string;
  url?: string;
  secret?: string;
  'non-interactive'?: boolean;
}

interface WebhookUpdateCommandFlags {
  id: string;
  event?: WebhookType;
  url?: string;
  secret?: string;
  'non-interactive': boolean;
}

const EVENT_FLAG_OPTIONS = [WebhookType.Build, WebhookType.Submit];

export default class WebhookUpdate extends EasCommand {
  static override description = 'update a webhook';

  static override flags = {
    id: Flags.string({
      description: 'Webhook ID',
      required: true,
    }),
    event: Flags.string({
      description: 'Event type that triggers the webhook',
      options: EVENT_FLAG_OPTIONS,
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
    const { flags: rawFlags } = await this.parse(WebhookUpdate);
    const flags = await this.sanitizeFlagsAsync(rawFlags);
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

  private async sanitizeFlagsAsync(
    flags: RawWebhookUpdateFlags
  ): Promise<WebhookUpdateCommandFlags> {
    return {
      ...flags,
      event: maybeGetWebhookType(flags.event),
      'non-interactive': flags['non-interactive'] ?? false,
    };
  }
}
