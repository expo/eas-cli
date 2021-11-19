import nullthrows from 'nullthrows';
import { URL } from 'url';

import { WebhookFragment, WebhookInput, WebhookType } from '../graphql/generated';
import Log from '../log';
import { promptAsync } from '../prompts';

export async function prepareInputParamsAsync(
  {
    event: maybeEvent,
    url: maybeUrl,
    secret: maybeSecret,
  }: {
    event?: WebhookType;
    url?: string;
    secret?: string;
  },
  existingWebhook?: WebhookFragment
): Promise<WebhookInput> {
  let event: WebhookType | undefined = maybeEvent;
  let url: string | undefined = maybeUrl;
  let secret: string | undefined = maybeSecret;

  if (!event) {
    const choices = [
      { title: 'Build', value: WebhookType.Build },
      { title: 'Submit', value: WebhookType.Submit },
    ];
    ({ event } = await promptAsync({
      type: 'select',
      name: 'event',
      message: 'Webhook event type:',
      choices,
      initial: existingWebhook?.event
        ? choices.findIndex(choice => choice.value === existingWebhook.event)
        : undefined,
    }));
  }

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
      initial: url ? undefined : existingWebhook?.url,
      validate: (value: string) => validateURL(value) || urlValidationMessage,
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
      validate: (value: string) => validateSecret(value) || secretValidationMessage,
    }));
  }

  return {
    event: nullthrows(event),
    url: nullthrows(url),
    secret: nullthrows(secret),
  };
}

export function validateURL(url: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
}

export function validateSecret(secret: string): boolean {
  return secret.length >= 16 && secret.length <= 1000;
}
