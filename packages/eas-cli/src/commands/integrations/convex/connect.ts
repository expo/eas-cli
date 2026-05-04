import spawnAsync from '@expo/spawn-async';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import dotenv from 'dotenv';
import * as fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../../commandUtils/EasCommand';
import { confirmRecentConvexInviteAsync, formatConvexTeam } from '../../../commandUtils/convex';
import { EASNonInteractiveFlag } from '../../../commandUtils/flags';
import { ConvexMutation } from '../../../graphql/mutations/ConvexMutation';
import { ConvexQuery } from '../../../graphql/queries/ConvexQuery';
import { ConvexTeamConnectionData } from '../../../graphql/types/ConvexTeamConnection';
import Log from '../../../log';
import { ora } from '../../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../../prompts';
import { Actor } from '../../../user/User';

const CONVEX_REGIONS = [
  { title: 'US East (aws-us-east-1)', value: 'aws-us-east-1' },
  { title: 'EU West (aws-eu-west-1)', value: 'aws-eu-west-1' },
];

const DEFAULT_REGION = 'aws-us-east-1';

type TeamInviteResult = 'sent' | 'skipped' | 'failed';

export default class IntegrationsConvexConnect extends EasCommand {
  static override description = 'connect Convex to your Expo project';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  static override flags = {
    ...EASNonInteractiveFlag,
    region: Flags.string({
      description: 'Convex deployment region (e.g. aws-us-east-1, aws-eu-west-1)',
      options: CONVEX_REGIONS.map(r => r.value),
    }),
    'team-name': Flags.string({
      description: 'Name for the new Convex team (defaults to EAS account name)',
    }),
    'project-name': Flags.string({
      description: 'Name for the Convex project (defaults to app slug)',
    }),
  };

  async runAsync(): Promise<void> {
    const {
      flags: {
        region: regionFlag,
        'team-name': teamNameFlag,
        'project-name': projectNameFlag,
        'non-interactive': nonInteractive,
      },
    } = await this.parse(IntegrationsConvexConnect);

    const {
      privateProjectConfig: { projectId, exp, projectDir },
      loggedIn: { graphqlClient, actor },
    } = await this.getContextAsync(IntegrationsConvexConnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    // 1. Check for existing Convex team connections
    const existingConnections = await ConvexQuery.getConvexTeamConnectionsByAccountIdAsync(
      graphqlClient,
      account.id
    );

    const region = await this.resolveRegionAsync(regionFlag, nonInteractive);
    let connection: ConvexTeamConnectionData | null = null;
    let teamName: string | null = null;

    if (existingConnections.length === 0) {
      // 2a. No connection - resolve a team name and create it after local package install succeeds
      teamName = await this.resolveTeamNameAsync(teamNameFlag, account.name, nonInteractive);
    } else if (existingConnections.length === 1) {
      // 2b. Single existing connection
      connection = existingConnections[0];
      Log.withTick(`Using existing Convex team ${chalk.bold(formatConvexTeam(connection))}`);
    } else {
      // 2c. Multiple connections - prompt to select
      connection = await this.selectConnectionAsync(existingConnections, nonInteractive);
    }

    // 3. Resolve project name before project setup mutation
    const projectName = await this.resolveProjectNameAsync(
      projectNameFlag,
      exp.slug,
      nonInteractive
    );

    // 4. Install the Convex package before creating new server-side resources
    await this.installConvexPackageAsync(projectDir);

    if (!connection) {
      const spinner = ora('Creating Convex team').start();
      try {
        connection = await ConvexMutation.createConvexTeamConnectionAsync(graphqlClient, {
          accountId: account.id,
          deploymentRegion: region,
          convexTeamName: teamName ?? account.name,
        });
        spinner.succeed(`Created Convex team ${chalk.bold(formatConvexTeam(connection))}`);
      } catch (error) {
        spinner.fail('Failed to create Convex team');
        throw error;
      }
    }

    // 5. Set up Convex project
    const spinner = ora('Setting up Convex project').start();
    let setupResult;
    try {
      setupResult = await ConvexMutation.setupConvexProjectAsync(graphqlClient, {
        appId: projectId,
        convexTeamConnectionId: connection.id,
        deploymentRegion: region,
        projectName,
      });
      spinner.succeed(
        `Created Convex project ${chalk.bold(projectName)} with deployment ${chalk.bold(setupResult.convexDeploymentName)}`
      );
    } catch (error) {
      spinner.fail('Failed to set up Convex project');
      throw error;
    }

    // 6. Send team invite (non-fatal)
    const teamInviteResult = await this.sendTeamInviteAsync(graphqlClient, connection, actor, {
      nonInteractive,
    });

    // 7. Write deploy key and URL to .env.local
    await this.writeEnvLocalAsync(
      projectDir,
      setupResult.deployKey,
      setupResult.convexDeploymentUrl,
      nonInteractive
    );

    // 8. Success message
    Log.addNewLineIfNone();
    Log.log(chalk.green('Convex is ready!'));
    Log.newLine();
    Log.log('Next steps:');
    Log.log(`  1. Start the Convex dev server: ${chalk.cyan('npx convex dev')}`);
    Log.newLine();
    if (teamInviteResult === 'sent') {
      Log.log(
        `Check your email for an invitation to join your Convex team. Accept it for full dashboard access.`
      );
    }
  }

  private async resolveRegionAsync(
    flagValue: string | undefined,
    nonInteractive: boolean
  ): Promise<string> {
    if (flagValue) {
      return flagValue;
    }
    if (nonInteractive) {
      return DEFAULT_REGION;
    }
    return await selectAsync('Select a Convex deployment region', CONVEX_REGIONS);
  }

  private async resolveTeamNameAsync(
    flagValue: string | undefined,
    accountName: string,
    nonInteractive: boolean
  ): Promise<string> {
    if (flagValue) {
      return flagValue;
    }
    if (nonInteractive) {
      return accountName;
    }
    const { teamName } = await promptAsync({
      type: 'text',
      name: 'teamName',
      message: 'Convex team name',
      initial: accountName,
      validate: (value: string) => (value.trim() ? true : 'Team name cannot be empty'),
    });
    return teamName;
  }

  private async resolveProjectNameAsync(
    flagValue: string | undefined,
    slug: string,
    nonInteractive: boolean
  ): Promise<string> {
    if (flagValue) {
      return flagValue;
    }
    if (nonInteractive) {
      return slug;
    }
    const { projectName } = await promptAsync({
      type: 'text',
      name: 'projectName',
      message: 'Convex project name',
      initial: slug,
      validate: (value: string) => (value.trim() ? true : 'Project name cannot be empty'),
    });
    return projectName;
  }

  private async selectConnectionAsync(
    connections: ConvexTeamConnectionData[],
    nonInteractive: boolean
  ): Promise<ConvexTeamConnectionData> {
    if (nonInteractive) {
      return connections[0];
    }
    const choices = connections.map(c => ({
      title: `${formatConvexTeam(c)} (created ${new Date(c.createdAt).toLocaleDateString()})`,
      value: c,
    }));
    return await selectAsync('Select a Convex team connection', choices);
  }

  private getActorEmail(actor: Actor): string | null {
    return actor.__typename === 'User' ? actor.email : null;
  }

  private async sendTeamInviteAsync(
    graphqlClient: Parameters<typeof ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync>[0],
    connection: ConvexTeamConnectionData,
    actor: Actor,
    { nonInteractive }: { nonInteractive: boolean }
  ): Promise<TeamInviteResult> {
    if (connection.hasBeenClaimed) {
      Log.warn('Convex team has already been claimed. Skipping Convex team invitation.');
      return 'skipped';
    }

    const email = this.getActorEmail(actor);
    if (!email) {
      Log.warn(
        `Could not determine your verified email address, so no Convex team invitation was sent. Run ${chalk.cyan(
          'eas integrations:convex:team:invite'
        )} after signing in with a user account.`
      );
      return 'skipped';
    }

    if (!(await confirmRecentConvexInviteAsync(connection, { nonInteractive }))) {
      Log.warn('Skipped sending Convex team invitation.');
      return 'skipped';
    }

    try {
      await ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync(graphqlClient, {
        convexTeamConnectionId: connection.id,
      });
      Log.withTick(`Sent Convex team invitation to ${chalk.bold(email)}`);
      return 'sent';
    } catch (error) {
      Log.warn(
        `Failed to send Convex team invitation to ${email}. Run ${chalk.cyan(
          'eas integrations:convex:team:invite'
        )} to retry.`
      );
      Log.warn(error instanceof Error ? error.message : String(error));
      return 'failed';
    }
  }

  private async installConvexPackageAsync(projectDir: string): Promise<void> {
    Log.newLine();
    Log.log(`Running ${chalk.bold('npx expo install convex')}`);
    Log.newLine();

    try {
      await spawnAsync('npx', ['expo', 'install', 'convex'], {
        cwd: projectDir,
        stdio: 'inherit',
      });
      Log.withTick(`Installed the ${chalk.bold('convex')} npm package`);
    } catch (error) {
      Log.warn(
        `Failed to install the ${chalk.bold('convex')} npm package. Run ${chalk.cyan(
          'npx expo install convex'
        )} from your project directory, then run ${chalk.cyan('npx convex dev')}.`
      );
      throw error;
    }
  }

  private async writeEnvLocalAsync(
    projectDir: string,
    deployKey: string,
    convexUrl: string,
    nonInteractive: boolean
  ): Promise<void> {
    const envPath = path.join(projectDir, '.env.local');
    let existingContent: Record<string, string> = {};
    let rawContent = '';

    if (await fs.pathExists(envPath)) {
      rawContent = await fs.readFile(envPath, 'utf8');
      existingContent = dotenv.parse(rawContent);

      if (existingContent.CONVEX_DEPLOY_KEY && !nonInteractive) {
        const overwrite = await confirmAsync({
          message: `.env.local already contains CONVEX_DEPLOY_KEY. Overwrite Convex values?`,
        });
        if (!overwrite) {
          Log.log('Skipping .env.local update. Deploy key:');
          Log.log(`  CONVEX_DEPLOY_KEY=${deployKey}`);
          Log.log(`  EXPO_PUBLIC_CONVEX_URL=${convexUrl}`);
          return;
        }
      }
    }

    const updatedContent = this.mergeEnvContent(rawContent, {
      CONVEX_DEPLOY_KEY: deployKey,
      EXPO_PUBLIC_CONVEX_URL: convexUrl,
    });

    await fs.writeFile(envPath, updatedContent);
    Log.withTick(`Wrote Convex config to ${chalk.bold('.env.local')}`);
  }

  private mergeEnvContent(rawContent: string, newVars: Record<string, string>): string {
    let content = rawContent;
    const keysToAdd: Record<string, string> = { ...newVars };

    for (const [key, value] of Object.entries(newVars)) {
      // Replace existing line if present
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
        delete keysToAdd[key];
      }
    }

    // Append any keys that weren't already in the file
    const remaining = Object.entries(keysToAdd);
    if (remaining.length > 0) {
      if (content.length > 0 && !content.endsWith('\n')) {
        content += '\n';
      }
      for (const [key, value] of remaining) {
        content += `${key}=${value}\n`;
      }
    }

    return content;
  }
}
