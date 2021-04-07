import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import ora from 'ora';

import { WebhookType } from '../../graphql/generated';
import { WebhookQuery } from '../../graphql/queries/WebhookQuery';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { formatWebhook } from '../../webhooks/formatWebhook';

export default class WebhookList extends Command {
  static description = 'List webhooks on the current project.';

  static flags = {
    event: flags.enum({
      description: 'Event type that triggers the webhook',
      options: [WebhookType.Build],
    }),
  };

  async run() {
    await ensureLoggedInAsync();
    const {
      flags: { event },
    } = this.parse(WebhookList);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);
    const projectFullName = await getProjectFullNameAsync(exp);

    const spinner = ora(`Fetching the list of webhook on project ${projectFullName}`).start();
    try {
      const webhooks = await WebhookQuery.byAppIdAsync(projectId, event && { event });
      if (webhooks.length === 0) {
        spinner.fail(`There are no webhooks on project ${projectFullName}`);
      } else {
        spinner.succeed(`Found ${webhooks.length} webhooks on project ${projectFullName}`);
        const list = webhooks
          .map(webhook => formatWebhook(webhook))
          .join(`\n\n${chalk.dim('———')}\n\n`);
        Log.log(`\n${list}`);
      }
    } catch (err) {
      spinner.fail(
        `Something went wrong and we couldn't fetch the webhook list ${projectFullName}`
      );
      throw err;
    }
  }
}
