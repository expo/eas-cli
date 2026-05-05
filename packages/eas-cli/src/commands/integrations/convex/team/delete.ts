import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../../commandUtils/EasCommand';
import {
  formatConvexTeam,
  formatConvexTeamConnection,
  getConvexTeamDashboardUrl,
  logNoConvexTeams,
} from '../../../../commandUtils/convex';
import { EASNonInteractiveFlag } from '../../../../commandUtils/flags';
import { ConvexMutation } from '../../../../graphql/mutations/ConvexMutation';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import { ConvexTeamConnectionData } from '../../../../graphql/types/ConvexTeamConnection';
import Log, { link } from '../../../../log';
import { ora } from '../../../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../../../prompts';

export default class IntegrationsConvexTeamDelete extends EasCommand {
  static override description =
    "remove a Convex team link from the current Expo app owner account's EAS servers";

  static override args = {
    CONVEX_TEAM: Args.string({
      required: false,
      description: 'Slug of the Convex team to remove',
    }),
  };

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
      args: { CONVEX_TEAM: team },
      flags: { 'non-interactive': nonInteractive, yes },
    } = await this.parse(IntegrationsConvexTeamDelete);

    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsConvexTeamDelete, {
      nonInteractive,
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

    const connection = await this.resolveConnectionAsync(connections, team, nonInteractive);

    Log.addNewLineIfNone();
    Log.log(formatConvexTeamConnection(connection));
    Log.newLine();

    const dashboardUrl = getConvexTeamDashboardUrl(connection);
    if (!nonInteractive && !yes) {
      const confirmed = await confirmAsync({
        message: `Remove this Convex team link from EAS servers? This does not destroy resources on Convex. Convex dashboard: ${link(
          dashboardUrl,
          { dim: false }
        )}`,
      });
      if (!confirmed) {
        Log.error('Canceled deletion of the Convex team link');
        return;
      }
    } else {
      Log.warn(
        `Removing the Convex team link from EAS servers. This does not destroy resources on Convex: ${dashboardUrl}`
      );
    }

    const spinner = ora('Removing Convex team link').start();
    try {
      await ConvexMutation.deleteConvexTeamConnectionAsync(graphqlClient, connection.id);
      spinner.succeed(
        `Removed Convex team ${chalk.bold(formatConvexTeam(connection))} from EAS servers`
      );
    } catch (error) {
      spinner.fail('Failed to remove Convex team link');
      throw error;
    }
  }

  private async resolveConnectionAsync(
    connections: ConvexTeamConnectionData[],
    team: string | undefined,
    nonInteractive: boolean
  ): Promise<ConvexTeamConnectionData> {
    if (team) {
      const connection = connections.find(
        item => item.convexTeamSlug === team || item.convexTeamName === team || item.id === team
      );
      if (!connection) {
        throw new Error(`Convex team ${team} is not linked to this account.`);
      }
      return connection;
    }

    if (connections.length === 1) {
      return connections[0];
    }

    if (nonInteractive) {
      throw new Error(
        'Convex team slug must be provided in non-interactive mode when multiple Convex team links exist.'
      );
    }

    return await selectAsync(
      'Select a Convex team link to remove',
      connections.map(connection => ({
        title: formatConvexTeam(connection),
        value: connection,
      }))
    );
  }
}
