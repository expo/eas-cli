import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { WebhookType } from '../../graphql/generated';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { formatWebhook } from '../../webhooks/formatWebhook';

export default class WebhookList extends EasCommand {
  static override description = 'list webhooks';

  static override flags = {
    event: Flags.enum({
      description: 'Event type that triggers the webhook',
      options: [WebhookType.Build, WebhookType.Submit],
    }),
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { event, json },
    } = await this.parse(WebhookList);
    if (json) {
      enableJsonOutput();
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WebhookList, {
      nonInteractive: true,
    });

    const projectDisplayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    const spinner = ora(`Fetching the list of webhook on project ${projectDisplayName}`).start();
    try {
      const webhooks = await WebhookQuery.byAppIdAsync(
        graphqlClient,
        projectId,
        event && { event }
      );
      if (webhooks.length === 0) {
        spinner.fail(`There are no webhooks on project ${projectDisplayName}`);
      } else {
        spinner.succeed(`Found ${webhooks.length} webhooks on project ${projectDisplayName}`);

        if (json) {
          printJsonOnlyOutput(webhooks);
        } else {
          const list = webhooks
            .map(webhook => formatWebhook(webhook))
            .join(`\n\n${chalk.dim('———')}\n\n`);
          Log.log(`\n${list}`);
        }
      }
    } catch (err) {
      spinner.fail(
        `Something went wrong and we couldn't fetch the webhook list for the project ${projectDisplayName}`
      );
      throw err;
    }
  }
}
