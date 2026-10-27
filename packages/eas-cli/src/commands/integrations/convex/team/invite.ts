import { Args } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../../commandUtils/EasCommand';
import {
  confirmRecentConvexInviteAsync,
  formatConvexInviteTimestamp,
  formatConvexTeam,
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
import { selectAsync } from '../../../../prompts';

export default class IntegrationsConvexTeamInvite extends EasCommand {
  static override description = 'send a Convex team invitation to your verified email address';

  static override args = {
    CONVEX_TEAM: Args.string({
      required: false,
      description: 'Slug of the Convex team to invite yourself to',
    }),
  };

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const {
      args: { CONVEX_TEAM: team },
      flags: { 'non-interactive': nonInteractive },
    } = await this.parse(IntegrationsConvexTeamInvite);

    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient, actor },
    } = await this.getContextAsync(IntegrationsConvexTeamInvite, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const email = this.getActorEmail(actor);
    if (!email) {
      Log.warn(
        `Could not determine your verified email address, so no Convex team invitation was sent. Run ${chalk.cyan(
          'eas integrations:convex:team:invite'
        )} after signing in with a user account.`
      );
      return;
    }

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
    this.logTeam(connection);
    this.logPreviousInvite(connection);
    Log.newLine();

    if (connection.hasBeenClaimed) {
      Log.warn('Convex team has already been claimed. Skipping Convex team invitation.');
      return;
    }

    if (!(await confirmRecentConvexInviteAsync(connection, { nonInteractive }))) {
      Log.warn('Skipped sending Convex team invitation.');
      return;
    }

    const spinner = ora(`Sending Convex team invitation to ${email}`).start();
    try {
      await ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync(graphqlClient, {
        convexTeamConnectionId: connection.id,
      });
      spinner.succeed(
        `Sent Convex team invitation to ${chalk.bold(email)} for ${chalk.bold(formatConvexTeam(connection))}`
      );
      Log.log(`Convex dashboard: ${link(getConvexTeamDashboardUrl(connection), { dim: false })}`);
    } catch (error) {
      spinner.fail('Failed to send Convex team invitation');
      throw error;
    }
  }

  private getActorEmail(actor: { __typename: string; [key: string]: any }): string | null {
    return 'email' in actor && typeof actor.email === 'string' ? actor.email : null;
  }

  private logTeam(connection: ConvexTeamConnectionData): void {
    Log.log(chalk.bold(`Convex team ${formatConvexTeam(connection)}`));
    Log.log(
      `${chalk.bold('Dashboard')}: ${link(getConvexTeamDashboardUrl(connection), { dim: false })}`
    );
    Log.log(`${chalk.bold('Claimed')}: ${connection.hasBeenClaimed ? 'Yes' : 'No'}`);
  }

  private logPreviousInvite(connection: ConvexTeamConnectionData): void {
    if (!connection.invitedEmail && !connection.invitedAt) {
      return;
    }

    Log.newLine();
    Log.log(chalk.bold('Previous invite'));
    if (connection.invitedEmail) {
      Log.log(`${chalk.bold('Email')}: ${connection.invitedEmail}`);
    }
    if (connection.invitedAt) {
      Log.log(`${chalk.bold('Sent at')}: ${formatConvexInviteTimestamp(connection.invitedAt)}`);
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
      'Select a Convex team link to invite yourself to',
      connections.map(connection => ({
        title: formatConvexTeam(connection),
        value: connection,
      }))
    );
  }
}
