import openBrowserAsync from 'better-opn';

import EasCommand from '../../../commandUtils/EasCommand';
import { getConvexProjectDashboardUrl, logNoConvexProject } from '../../../commandUtils/convex';
import { ConvexQuery } from '../../../graphql/queries/ConvexQuery';
import { ora } from '../../../ora';

export default class IntegrationsConvexDashboard extends EasCommand {
  static override description = 'open the Convex dashboard for the linked Convex project';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsConvexDashboard, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const convexProject = await ConvexQuery.getConvexProjectByAppIdAsync(graphqlClient, projectId);

    if (!convexProject) {
      logNoConvexProject(exp.slug);
      return;
    }

    const dashboardUrl = getConvexProjectDashboardUrl(convexProject);
    const failedMessage = `Unable to open a web browser. Convex dashboard is available at: ${dashboardUrl}`;
    const spinner = ora(`Opening ${dashboardUrl}`).start();
    try {
      const opened = await openBrowserAsync(dashboardUrl);
      if (opened) {
        spinner.succeed(`Opened ${dashboardUrl}`);
      } else {
        spinner.fail(failedMessage);
      }
    } catch (error) {
      spinner.fail(failedMessage);
      throw error;
    }
  }
}
