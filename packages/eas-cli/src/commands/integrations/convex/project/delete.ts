import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../../commandUtils/EasCommand';
import {
  formatConvexProject,
  getConvexProjectDashboardUrl,
  logNoConvexProject,
} from '../../../../commandUtils/convex';
import { EASNonInteractiveFlag } from '../../../../commandUtils/flags';
import { ConvexMutation } from '../../../../graphql/mutations/ConvexMutation';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import Log, { link } from '../../../../log';
import { ora } from '../../../../ora';
import { confirmAsync } from '../../../../prompts';

export default class IntegrationsConvexProjectDelete extends EasCommand {
  static override description =
    'remove the Convex project link for the current Expo app from EAS servers';

  static override flags = {
    ...EASNonInteractiveFlag,
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
    const {
      flags: { 'non-interactive': nonInteractive, yes },
    } = await this.parse(IntegrationsConvexProjectDelete);

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsConvexProjectDelete, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const convexProject = await ConvexQuery.getConvexProjectByAppIdAsync(graphqlClient, projectId);

    if (!convexProject) {
      logNoConvexProject(exp.slug);
      return;
    }

    Log.addNewLineIfNone();
    Log.log(formatConvexProject(convexProject));
    Log.newLine();

    const dashboardUrl = getConvexProjectDashboardUrl(convexProject);
    if (!nonInteractive && !yes) {
      const confirmed = await confirmAsync({
        message: `Remove this Convex project link from EAS servers? This does not destroy resources on Convex. Convex dashboard: ${link(
          dashboardUrl,
          { dim: false }
        )}`,
      });
      if (!confirmed) {
        Log.error('Canceled deletion of the Convex project link');
        return;
      }
    } else {
      Log.warn(
        `Removing the Convex project link from EAS servers. This does not destroy resources on Convex: ${dashboardUrl}`
      );
    }

    const spinner = ora('Removing Convex project link').start();
    try {
      await ConvexMutation.deleteConvexProjectAsync(graphqlClient, convexProject.id);
      spinner.succeed(
        `Removed Convex project ${chalk.bold(convexProject.convexProjectName)} from EAS servers`
      );
    } catch (error) {
      spinner.fail('Failed to remove Convex project link');
      throw error;
    }
  }
}
