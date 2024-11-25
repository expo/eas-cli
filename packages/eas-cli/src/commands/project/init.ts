import { ConfigError, ExpoConfig, getProjectConfigDescription } from '@expo/config';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { getProjectDashboardUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { saveProjectIdToAppConfigAsync } from '../../commandUtils/context/contextUtils/getProjectIdAsync';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { Role } from '../../graphql/generated';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { Choice, confirmAsync, promptAsync } from '../../prompts';
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
      description:
        'Whether to create a new project/link an existing project without additional prompts or overwrite any existing project ID when running with --id flag',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  private static async saveProjectIdAndLogSuccessAsync(
    projectDir: string,
    projectId: string
  ): Promise<void> {
    await saveProjectIdToAppConfigAsync(projectDir, projectId);
    Log.withTick(`Project successfully linked (ID: ${chalk.bold(projectId)}) (modified app.json)`);
  }

  private static async modifyExpoConfigAsync(
    projectDir: string,
    modifications: Partial<ExpoConfig>
  ): Promise<void> {
    let result;
    try {
      result = await createOrModifyExpoConfigAsync(projectDir, modifications);
    } catch (error) {
      if (error instanceof ConfigError && error.code === 'MODULE_NOT_FOUND') {
        Log.warn(
          'Cannot determine which native SDK version your project uses because the module `expo` is not installed.'
        );
        return;
      } else {
        throw error;
      }
    }
    switch (result.type) {
      case 'success':
        break;
      case 'warn': {
        Log.warn();
        Log.warn(
          `Warning: Your project uses dynamic app configuration, and cannot be automatically modified.`
        );
        Log.warn(
          chalk.dim(
            'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs'
          )
        );
        Log.warn();
        Log.warn(
          `To complete the setup process, add the following in your ${chalk.bold(
            getProjectConfigDescription(projectDir)
          )}:`
        );
        Log.warn();
        Log.warn(chalk.bold(JSON.stringify(modifications, null, 2)));
        Log.warn();
        throw new Error(result.message);
      }
      case 'fail':
        throw new Error(result.message);
      default:
        throw new Error('Unexpected result type from modifyConfigAsync');
    }
  }

  private static async ensureOwnerSlugConsistencyAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string,
    projectDir: string,
    { force, nonInteractive }: InitializeMethodOptions
  ): Promise<void> {
    const exp = await getPrivateExpoConfigAsync(projectDir);
    const appForProjectId = await AppQuery.byIdAsync(graphqlClient, projectId);
    const correctOwner = appForProjectId.ownerAccount.name;
    const correctSlug = appForProjectId.slug;

    if (exp.owner && exp.owner !== correctOwner) {
      if (force) {
        await this.modifyExpoConfigAsync(projectDir, { owner: correctOwner });
      } else {
        const message = `Project owner (${correctOwner}) does not match the value configured in the "owner" field (${exp.owner}).`;
        if (nonInteractive) {
          throw new Error(`Project config error: ${message} Use --force flag to overwrite.`);
        }

        const confirm = await confirmAsync({
          message: `${message}. Do you wish to overwrite it?`,
        });
        if (!confirm) {
          throw new Error('Aborting');
        }

        await this.modifyExpoConfigAsync(projectDir, { owner: correctOwner });
      }
    } else if (!exp.owner) {
      await this.modifyExpoConfigAsync(projectDir, { owner: correctOwner });
    }

    if (exp.slug && exp.slug !== correctSlug) {
      if (force) {
        await this.modifyExpoConfigAsync(projectDir, { slug: correctSlug });
      } else {
        const message = `Project slug (${correctSlug}) does not match the value configured in the "slug" field (${exp.slug}).`;
        if (nonInteractive) {
          throw new Error(`Project config error: ${message} Use --force flag to overwrite.`);
        }

        const confirm = await confirmAsync({
          message: `${message}. Do you wish to overwrite it?`,
        });
        if (!confirm) {
          throw new Error('Aborting');
        }

        await this.modifyExpoConfigAsync(projectDir, { slug: correctSlug });
      }
    } else if (!exp.slug) {
      await this.modifyExpoConfigAsync(projectDir, { slug: correctSlug });
    }
  }

  private static async setExplicitIDAsync(
    projectId: string,
    projectDir: string,
    { force, nonInteractive }: InitializeMethodOptions
  ): Promise<void> {
    const exp = await getPrivateExpoConfigAsync(projectDir);
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
        throw new Error('Aborting');
      }

      await ProjectInit.saveProjectIdAndLogSuccessAsync(projectDir, projectId);
    }
  }

  private static async initializeWithExplicitIDAsync(
    projectId: string,
    projectDir: string,
    { force, nonInteractive }: InitializeMethodOptions
  ): Promise<void> {
    await this.setExplicitIDAsync(projectId, projectDir, {
      force,
      nonInteractive,
    });
  }

  private static async initializeWithoutExplicitIDAsync(
    graphqlClient: ExpoGraphqlClient,
    actor: Actor,
    projectDir: string,
    { force, nonInteractive }: InitializeMethodOptions
  ): Promise<string> {
    const exp = await getPrivateExpoConfigAsync(projectDir);
    const existingProjectId = exp.extra?.eas?.projectId;

    if (existingProjectId) {
      Log.succeed(
        `Project already linked (ID: ${chalk.bold(
          existingProjectId
        )}). To re-configure, remove the "extra.eas.projectId" field from your app config.`
      );
      return existingProjectId;
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
      } else if (nonInteractive) {
        if (!force) {
          throw new Error(
            `There are multiple accounts that you have access to: ${allAccounts
              .map(a => a.name)
              .join(
                ', '
              )}. Explicitly set the owner property in your app config or run this command with the --force flag to proceed with a default account: ${
              allAccounts[0].name
            }.`
          );
        }
        accountName = allAccounts[0].name;
        Log.log(`Using default account ${accountName} for non-interactive and force mode`);
      } else {
        const choices = ProjectInit.getAccountChoices(
          actor,
          accountNamesWhereUserHasSufficientPermissionsToCreateApp
        );

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
      graphqlClient,
      accountName,
      projectName
    );
    if (existingProjectIdOnServer) {
      if (!force) {
        if (nonInteractive) {
          throw new Error(
            `Existing project found: ${projectFullName} (ID: ${existingProjectIdOnServer}). Use --force flag to continue with this project.`
          );
        }

        const affirmedLink = await confirmAsync({
          message: `Existing project found: ${projectFullName} (ID: ${existingProjectIdOnServer}). Link this project?`,
        });
        if (!affirmedLink) {
          throw new Error(
            `Project ID configuration canceled. Re-run the command to select a different account/project.`
          );
        }
      }

      await ProjectInit.saveProjectIdAndLogSuccessAsync(projectDir, existingProjectIdOnServer);
      return existingProjectIdOnServer;
    }

    if (!accountNamesWhereUserHasSufficientPermissionsToCreateApp.has(accountName)) {
      throw new Error(
        `You don't have permission to create a new project on the ${accountName} account and no matching project already exists on the account.`
      );
    }

    if (!force) {
      if (nonInteractive) {
        throw new Error(
          `Project does not exist: ${projectFullName}. Use --force flag to create this project.`
        );
      }
      const affirmedCreate = await confirmAsync({
        message: `Would you like to create a project for ${projectFullName}?`,
      });
      if (!affirmedCreate) {
        throw new Error(`Project ID configuration canceled for ${projectFullName}.`);
      }
    }

    const projectDashboardUrl = getProjectDashboardUrl(accountName, projectName);
    const projectLink = link(projectDashboardUrl, { text: projectFullName });

    const account = nullthrows(allAccounts.find(a => a.name === accountName));

    const spinner = ora(`Creating ${chalk.bold(projectFullName)}`).start();
    let createdProjectId: string;
    try {
      createdProjectId = await AppMutation.createAppAsync(graphqlClient, {
        accountId: account.id,
        projectName,
      });
      spinner.succeed(`Created ${chalk.bold(projectLink)}`);
    } catch (err) {
      spinner.fail();
      throw err;
    }

    await ProjectInit.saveProjectIdAndLogSuccessAsync(projectDir, createdProjectId);
    return createdProjectId;
  }

  private static getAccountChoices(
    actor: Actor,
    namesWithSufficientPermissions: Set<string>
  ): Choice[] {
    const allAccounts = actor.accounts;

    const sortedAccounts =
      actor.__typename === 'Robot'
        ? allAccounts
        : [...allAccounts].sort((a, _b) =>
            actor.__typename === 'User' ? (a.name === actor.username ? -1 : 1) : 0
          );

    if (actor.__typename !== 'Robot') {
      const personalAccount = allAccounts?.find(
        account => account?.ownerUserActor?.id === actor.id
      );

      const personalAccountChoice = personalAccount
        ? {
            title: personalAccount.name,
            value: personalAccount,
            description: !namesWithSufficientPermissions.has(personalAccount.name)
              ? '(Personal) (Viewer Role)'
              : '(Personal)',
          }
        : undefined;

      const userAccounts = allAccounts
        ?.filter(account => account.ownerUserActor && account.name !== actor.username)
        .map(account => ({
          title: account.name,
          value: account,
          description: !namesWithSufficientPermissions.has(account.name)
            ? '(Team) (Viewer Role)'
            : '(Team)',
        }));

      const organizationAccounts = allAccounts
        ?.filter(account => account.name !== actor.username && !account.ownerUserActor)
        .map(account => ({
          title: account.name,
          value: account,
          description: !namesWithSufficientPermissions.has(account.name)
            ? '(Organization) (Viewer Role)'
            : '(Organization)',
        }));

      let choices: Choice[] = [];
      if (personalAccountChoice) {
        choices = [personalAccountChoice];
      }

      return [...choices, ...userAccounts, ...organizationAccounts].sort((a, _b) =>
        actor.__typename === 'User' ? (a.value.name === actor.username ? -1 : 1) : 0
      );
    }

    return sortedAccounts.map(account => ({
      title: account.name,
      value: account,
      description: !namesWithSufficientPermissions.has(account.name) ? '(Viewer Role)' : undefined,
    }));
  }

  async runAsync(): Promise<void> {
    const {
      flags: { id: idArgument, force, 'non-interactive': nonInteractive },
    } = await this.parse(ProjectInit);
    const {
      loggedIn: { actor, graphqlClient },
      projectDir,
    } = await this.getContextAsync(ProjectInit, { nonInteractive });

    let idForConsistency: string;
    if (idArgument) {
      await ProjectInit.initializeWithExplicitIDAsync(idArgument, projectDir, {
        force,
        nonInteractive,
      });
      idForConsistency = idArgument;
    } else {
      idForConsistency = await ProjectInit.initializeWithoutExplicitIDAsync(
        graphqlClient,
        actor,
        projectDir,
        {
          force,
          nonInteractive,
        }
      );
    }

    await ProjectInit.ensureOwnerSlugConsistencyAsync(graphqlClient, idForConsistency, projectDir, {
      force,
      nonInteractive,
    });
  }
}
