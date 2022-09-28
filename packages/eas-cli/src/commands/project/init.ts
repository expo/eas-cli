import { Flags } from '@oclif/core';
import chalk from 'chalk';
import nullthrows from 'nullthrows';
import terminalLink from 'terminal-link';

import { getProjectDashboardUrl } from '../../build/utils/url';
import EasCommand, {
  EASCommandLoggedInContext,
  EASCommandProjectDirContext,
} from '../../commandUtils/EasCommand';
import ProjectIdContextField from '../../commandUtils/context/ProjectConfigContextField';
import { AppPrivacy, Role } from '../../graphql/generated';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import Log from '../../log';
import { ora } from '../../ora';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { toAppPrivacy } from '../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../prompts';
import { Actor } from '../../user/User';

type InitializeMethodOptions = {
  force: boolean;
  nonInteractive: boolean;
};

export default class ProjectInit extends EasCommand {
  static override description = 'create or link an EAS project';
  static override aliases = ['init'];

  static override flags = {
    id: Flags.string({
      description: 'ID of the EAS project to link',
    }),
    force: Flags.boolean({
      description: 'Whether to overwrite any existing project ID',
      dependsOn: ['id'],
    }),
    // this is the same as EASNonInteractiveFlag but with the dependsOn
    'non-interactive': Flags.boolean({
      description: 'Run the command in non-interactive mode.',
      dependsOn: ['id'],
    }),
  };

  static override contextDefinition = {
    ...EASCommandLoggedInContext,
    ...EASCommandProjectDirContext,
  };

  private static async saveProjectIdAndLogSuccessAsync(
    projectDir: string,
    projectId: string
  ): Promise<void> {
    await ProjectIdContextField['saveProjectIdToAppConfigAsync'](projectDir, projectId);
    Log.withTick(`Project successfully linked (ID: ${chalk.bold(projectId)}) (modified app.json)`);
  }

  private static async initializeWithExplicitIDAsync(
    projectId: string,
    projectDir: string,
    { force, nonInteractive }: InitializeMethodOptions
  ): Promise<void> {
    const exp = getExpoConfig(projectDir);
    const existingProjectId = exp.extra?.eas?.projectId;

    if (projectId === existingProjectId) {
      Log.succeed(`Project already linked (ID: ${chalk.bold(existingProjectId)})`);
      return;
    }

    if (!existingProjectId) {
      await ProjectInit.saveProjectIdAndLogSuccessAsync(projectDir, projectId);
      return;
    }

    if (projectId !== existingProjectId) {
      if (force) {
        await ProjectInit.saveProjectIdAndLogSuccessAsync(projectDir, projectId);
        return;
      }

      if (nonInteractive) {
        throw new Error(
          `Project is already linked to a different ID: ${chalk.bold(
            existingProjectId
          )}. Use --force flag to overwrite.`
        );
      }

      const confirm = await confirmAsync({
        message: `Project is already linked to a different ID: ${chalk.bold(
          existingProjectId
        )}. Do you wish to overwrite it?`,
      });
      if (!confirm) {
        Log.log('Aborting');
        return;
      }

      await ProjectInit.saveProjectIdAndLogSuccessAsync(projectDir, projectId);
    }
  }

  private static async initializeWithInteractiveSelectionAsync(
    actor: Actor,
    projectDir: string
  ): Promise<void> {
    const exp = getExpoConfig(projectDir);
    const existingProjectId = exp.extra?.eas?.projectId;

    if (existingProjectId) {
      Log.succeed(
        `Project already linked (ID: ${chalk.bold(
          existingProjectId
        )}). To re-configure, remove the extra.eas.projectId field from your app config.`
      );
      return;
    }

    const allAccounts = actor.accounts;
    const accountNamesWhereUserHasSufficientPermissionsToCreateApp = new Set(
      allAccounts
        .filter(a => a.users.find(it => it.actor.id === actor.id)?.role !== Role.ViewOnly)
        .map(it => it.name)
    );

    // if no owner field, ask the user which account they want to use to create/link the project
    let accountName = exp.owner;
    if (!accountName) {
      if (allAccounts.length === 1) {
        accountName = allAccounts[0].name;
      } else {
        // if regular user, put primary account first
        const sortedAccounts =
          actor.__typename === 'Robot'
            ? allAccounts
            : [...allAccounts].sort((a, _b) => (a.name === actor.username ? -1 : 1));

        const choices = sortedAccounts.map(account => ({
          title: account.name,
          value: account,
          description: !accountNamesWhereUserHasSufficientPermissionsToCreateApp.has(account.name)
            ? '(Viewer Role)'
            : undefined,
        }));
        accountName = (
          await promptAsync({
            type: 'select',
            name: 'account',
            message: 'Which account should own this project?',
            choices,
          })
        ).account.name;
      }
    }

    if (!accountName) {
      throw new Error('No account selected for project. Canceling.');
    }

    const projectName = exp.slug;
    const projectFullName = `@${accountName}/${projectName}`;
    const existingProjectIdOnServer = await findProjectIdByAccountNameAndSlugNullableAsync(
      accountName,
      projectName
    );
    if (existingProjectIdOnServer) {
      const affirmedLink = await confirmAsync({
        message: `Existing project found: ${projectFullName} (ID: ${existingProjectIdOnServer}). Link this project?`,
      });
      if (!affirmedLink) {
        throw new Error(
          `Project ID configuration canceled. Re-run the command to select a different account/project.`
        );
      }

      await ProjectInit.saveProjectIdAndLogSuccessAsync(projectDir, existingProjectIdOnServer);
      return;
    }

    if (!accountNamesWhereUserHasSufficientPermissionsToCreateApp.has(accountName)) {
      throw new Error(
        `You don't have permission to create a new project on the ${accountName} account and no matching project already exists on the account.`
      );
    }

    const affirmedCreate = await confirmAsync({
      message: `Would you like to create a project for ${projectFullName}?`,
    });
    if (!affirmedCreate) {
      throw new Error(`Project ID configuration canceled for ${projectFullName}.`);
    }

    const projectDashboardUrl = getProjectDashboardUrl(accountName, projectName);
    const projectLink = terminalLink(projectFullName, projectDashboardUrl, {
      // https://github.com/sindresorhus/terminal-link/issues/18#issuecomment-1068020361
      fallback: () => `${projectFullName} (${projectDashboardUrl})`,
    });

    const account = nullthrows(allAccounts.find(a => a.name === accountName));

    const spinner = ora(`Creating ${chalk.bold(projectFullName)}`).start();
    let createdProjectId: string;
    try {
      createdProjectId = await AppMutation.createAppAsync({
        accountId: account.id,
        projectName,
        privacy: toAppPrivacy(exp.privacy) ?? AppPrivacy.Public,
      });
      spinner.succeed(`Created ${chalk.bold(projectLink)}`);
    } catch (err) {
      spinner.fail();
      throw err;
    }

    await ProjectInit.saveProjectIdAndLogSuccessAsync(projectDir, createdProjectId);
  }

  async runAsync(): Promise<void> {
    const {
      flags: { id, force, 'non-interactive': nonInteractive },
    } = await this.parse(ProjectInit);
    const { actor, projectDir } = await this.getContextAsync(ProjectInit, { nonInteractive });

    if (id) {
      await ProjectInit.initializeWithExplicitIDAsync(id, projectDir, { force, nonInteractive });
    } else {
      await ProjectInit.initializeWithInteractiveSelectionAsync(actor, projectDir);
    }
  }
}
