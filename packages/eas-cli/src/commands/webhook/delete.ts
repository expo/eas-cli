import assert from 'assert';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { WebhookFragment } from '../../graphql/generated';
import { WebhookMutation } from '../../graphql/mutations/WebhookMutation';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { promptAsync, toggleConfirmAsync } from '../../prompts';
import { formatWebhook } from '../../webhooks/formatWebhook';

export default class WebhookDelete extends EasCommand {
  static override description = 'delete a webhook';

  static override args = [
    {
      name: 'ID',
      required: false,
      description: 'ID of the webhook to delete',
    },
  ];

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      args: { ID: webhookId },
      flags: { 'non-interactive': nonInteractive },
    } = await this.parse(WebhookDelete);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WebhookDelete, {
      nonInteractive,
    });

    let webhook: WebhookFragment | undefined =
      webhookId && (await WebhookQuery.byIdAsync(graphqlClient, webhookId));
    if (!webhookId) {
      const webhooks = await fetchWebhooksByAppIdAsync(graphqlClient, projectId);
      if (webhooks.length === 0) {
        process.exit(1);
      }

      if (nonInteractive) {
        throw new Error('Must supply ID argument in non-interactive mode');
      }

      ({ webhook } = await promptAsync({
        type: 'autocomplete',
        name: 'webhook',
        message: 'Pick the webhook to be deleted:',
        choices: webhooks.map(i => ({
          title: `${chalk.bold(i.url)} (Event: ${i.event}, ID: ${i.id})`,
          value: i,
        })),
      }));
      webhookId = nullthrows(webhook).id;
    }

    assert(webhook, 'Webhook must be defined here');

    Log.addNewLineIfNone();
    Log.log(formatWebhook(webhook));
    Log.newLine();

    if (!nonInteractive) {
      Log.warn(`You are about to permanently delete this webhook.\nThis action is irreversible.`);
      Log.newLine();
      const confirmed = await toggleConfirmAsync({
        message: 'Are you sure you wish to proceed?',
      });
      if (!confirmed) {
        Log.error(`Canceled deletion of the webhook`);
        process.exit(1);
      }
    }

    const spinner = ora('Deleting the webhook').start();
    try {
      await WebhookMutation.deleteWebhookAsync(graphqlClient, webhookId);
      spinner.succeed('Successfully deleted the webhook');
    } catch (err) {
      spinner.fail('Failed to delete the webhook');
      throw err;
    }
  }
}

async function fetchWebhooksByAppIdAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string
): Promise<WebhookFragment[]> {
  const spinner = ora('Fetching webhooks').start();
  try {
    const webhooks = await WebhookQuery.byAppIdAsync(graphqlClient, appId);
    if (webhooks.length === 0) {
      spinner.fail('There are no webhooks on the project');
      return [];
    } else {
      spinner.succeed(`Successfully fetched ${webhooks.length} webhooks`);
      return webhooks;
    }
  } catch (err) {
    spinner.fail("Something went wrong and we couldn't fetch the webhook list");
    throw err;
  }
}
