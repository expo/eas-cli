import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { formatConvexTeamConnection, logNoConvexTeams } from '../../../commandUtils/convex';
import { ConvexQuery } from '../../../graphql/queries/ConvexQuery';
import Log from '../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';

export default class IntegrationsConvexTeam extends EasCommand {
  static override description =
    "display Convex teams linked to the current Expo app's owner account";

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsConvexTeam, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    const connections = await ConvexQuery.getConvexTeamConnectionsByAccountIdAsync(
      graphqlClient,
      account.id
    );

    if (connections.length === 0) {
      logNoConvexTeams(account.name);
      return;
    }

    Log.log(chalk.bold(`Convex teams linked to @${account.name}`));
    for (const [index, connection] of connections.entries()) {
      if (index > 0) {
        Log.newLine();
      }
      Log.log(formatConvexTeamConnection(connection));
    }
  }
}
