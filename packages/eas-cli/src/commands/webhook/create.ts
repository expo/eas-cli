import { getConfig } from '@expo/config';
import { flags } from '@oclif/command';
import ora from 'ora';

import EasCommand from '../../commandUtils/EasCommand';
import { WebhookType } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { prepareInputParamsAsync } from '../../webhooks/input';

export default class WebhookCreate extends EasCommand {
  static description = 'Create a webhook on the current project.';

  static flags = {
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

  async runAsync(): Promise<void> {
    const { flags } = this.parse(WebhookCreate);
    const webhookInputParams = await prepareInputParamsAsync(flags);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
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
