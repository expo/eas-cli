import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { WebhookType } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import { ora } from '../../ora';
import { prepareInputParamsAsync } from '../../webhooks/input';

interface RawWebhookCreateFlags {
  event?: string;
  url?: string;
  secret?: string;
  'non-interactive'?: boolean;
}

interface WebhookCreateCommandFlags {
  event?: WebhookType;
  url?: string;
  secret?: string;
  'non-interactive': boolean;
}

export function maybeGetWebhookType(
  webhookTypeString: string | undefined
): WebhookType | undefined {
  if (!webhookTypeString) {
    return undefined;
  }
  return Object.values(WebhookType).find(webhookType => webhookType === webhookTypeString);
}

const EVENT_FLAG_OPTIONS = [WebhookType.Build, WebhookType.Submit];

export default class WebhookCreate extends EasCommand {
  static override description = 'create a webhook';

  static override flags = {
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
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(WebhookCreate);
    const flags = await this.sanitizeFlagsAsync(rawFlags);
    const {
      privateProjectConfig: { projectId },
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

  private async sanitizeFlagsAsync(
    flags: RawWebhookCreateFlags
  ): Promise<WebhookCreateCommandFlags> {
    return {
      ...flags,
      event: maybeGetWebhookType(flags.event),
      'non-interactive': flags['non-interactive'] ?? false,
    };
  }
}
