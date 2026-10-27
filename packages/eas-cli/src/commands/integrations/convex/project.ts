import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { formatConvexProject, logNoConvexProject } from '../../../commandUtils/convex';
import { ConvexQuery } from '../../../graphql/queries/ConvexQuery';
import Log from '../../../log';

export default class IntegrationsConvexProject extends EasCommand {
  static override description = 'display the Convex project linked to the current Expo app';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsConvexProject, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const convexProject = await ConvexQuery.getConvexProjectByAppIdAsync(graphqlClient, projectId);

    if (!convexProject) {
      logNoConvexProject(exp.slug);
      return;
    }

    Log.log(chalk.bold(`Convex project linked to ${exp.slug}`));
    Log.log(formatConvexProject(convexProject));
  }
}
