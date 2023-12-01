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
import { maybeGetWebhookType } from './create';

interface RawWebhookListFlags {
  event?: string;
  json?: boolean;
}

interface WebhookListCommandFlags {
  event?: WebhookType;
  json?: boolean;
}

const EVENT_FLAG_OPTIONS = [WebhookType.Build, WebhookType.Submit];

export default class WebhookList extends EasCommand {
  static override description = 'list webhooks';

  static override flags = {
    event: Flags.string({
      description: 'Event type that triggers the webhook',
      options: EVENT_FLAG_OPTIONS,
    }),
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(WebhookList);
    const { event, json } = await this.sanitizeFlagsAsync(rawFlags);
    if (json) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId },
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

  private async sanitizeFlagsAsync(flags: RawWebhookListFlags): Promise<WebhookListCommandFlags> {
    return {
      ...flags,
      event: maybeGetWebhookType(flags.event),
    };
  }
}
