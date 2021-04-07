import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import nullthrows from 'nullthrows';
import ora from 'ora';
import { URL } from 'url';

import { WebhookInput, WebhookType } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import Log from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';

export default class WebhookCreate extends Command {
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

  async run() {
    await ensureLoggedInAsync();
    const { flags } = this.parse(WebhookCreate);
    const webhookInputParams = await this.prepareInputParams(flags);

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

  private async prepareInputParams({
    event,
    url: maybeUrl,
    secret: maybeSecret,
  }: {
    event: WebhookType;
    url?: string;
    secret?: string;
  }): Promise<WebhookInput> {
    let url: string | undefined = maybeUrl;
    let secret: string | undefined = maybeSecret;

    if (!url || !validateURL(url)) {
      const urlValidationMessage =
        'The provided webhook URL is invalid and must be an absolute URL, including a scheme.';
      if (url && !validateURL(url)) {
        Log.error(urlValidationMessage);
      }
      ({ url } = await promptAsync({
        type: 'text',
        name: 'url',
        message: 'Webhook URL:',
        validate: value => validateURL(value) || urlValidationMessage,
      }));
    }

    if (!secret || !validateSecret(secret)) {
      const secretValidationMessage =
        'Webhook secret has be at least 16 and not more than 1000 characters long';
      if (secret && !validateSecret(secret)) {
        Log.error(secretValidationMessage);
      }
      ({ secret } = await promptAsync({
        type: 'text',
        name: 'secret',
        message: 'Webhook secret:',
        validate: value => validateSecret(value) || secretValidationMessage,
      }));
    }

    return {
      event,
      url: nullthrows(url),
      secret: nullthrows(secret),
    };
  }
}

function validateURL(url: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
}

function validateSecret(secret: string): boolean {
  return secret.length >= 16 && secret.length <= 1000;
}
