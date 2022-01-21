import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { WebhookType } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import { ora } from '../../ora';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { prepareInputParamsAsync } from '../../webhooks/input';

export default class WebhookCreate extends EasCommand {
  static description = 'create a webhook';

  static flags = {
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
    const { flags } = await this.parse(WebhookCreate);
    const webhookInputParams = await prepareInputParamsAsync(flags);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    const spinner = ora('Creating a webhook').start();
    try {
      await WebhookMutation.createWebhookAsync(projectId, webhookInputParams);
      spinner.succeed('Successfully created a webhook');
    } catch (err) {
      spinner.fail('Failed to create a webhook');
      throw err;
    }
  }
}
