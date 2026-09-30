import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { formatPostHogProject, logNoPostHogProject } from '../../../commandUtils/posthog';
import { PostHogMutation } from '../../../graphql/mutations/PostHogMutation';
import { PostHogQuery } from '../../../graphql/queries/PostHogQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { confirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsPostHogDisconnect extends EasCommand {
  static override description =
    'remove the PostHog project link for the current Expo app from EAS servers';

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsPostHogDisconnect);
    const { yes } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsPostHogDisconnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const posthogProject = await PostHogQuery.getPostHogProjectByAppIdAsync(
      graphqlClient,
      projectId
    );

    if (!posthogProject) {
      if (jsonFlag) {
        printJsonOnlyOutput({ id: null });
      } else {
        logNoPostHogProject(exp.slug);
      }
      return;
    }

    if (!jsonFlag) {
      Log.addNewLineIfNone();
      Log.log(formatPostHogProject(posthogProject));
      Log.newLine();
    }

    if (!nonInteractive && !yes) {
      const confirmed = await confirmAsync({
        message:
          'Remove this PostHog project link from EAS servers? This does not delete the project on PostHog.',
      });
      if (!confirmed) {
        Log.warn('Canceled removal of the PostHog project link.');
        return;
      }
    } else if (!jsonFlag) {
      Log.warn(
        'Removing the PostHog project link from EAS servers. This does not delete the project on PostHog.'
      );
    }

    const spinner = jsonFlag ? null : ora('Removing PostHog project link').start();
    try {
      await PostHogMutation.deletePostHogProjectAsync(graphqlClient, posthogProject.id);
      spinner?.succeed(
        `Removed PostHog project ${chalk.bold(posthogProject.posthogProjectName)} from EAS servers`
      );
    } catch (error) {
      spinner?.fail('Failed to remove PostHog project link');
      throw error;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({ id: posthogProject.id, name: posthogProject.posthogProjectName });
    }
  }
}
