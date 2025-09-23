import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';
import path from 'path';

import { getProjectDashboardUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Role } from '../../graphql/generated';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import Log, { link } from '../../log';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../onboarding/git';
import {
  installDependenciesAsync,
  promptForPackageManagerAsync,
} from '../../onboarding/installDependencies';
import { runCommandAsync } from '../../onboarding/runCommand';
import { ora } from '../../ora';
import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { Choice, confirmAsync, promptAsync } from '../../prompts';
import { Actor, getActorUsername } from '../../user/User';

export default class New extends EasCommand {
  static override aliases = ['new'];

  static override description = "create a new project set up with Expo's services.";

  static override flags = {};

  static override hidden = true;

  static override args = [{ name: 'TARGET_PROJECT_DIRECTORY' }];

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { TARGET_PROJECT_DIRECTORY: targetProjectDirFromArgs },
    } = await this.parse(New);

    const {
      loggedIn: { actor, graphqlClient },
    } = await this.getContextAsync(New, { nonInteractive: false });

    if (actor.__typename === 'Robot') {
      throw new Error(
        'This command is not available for robot users. Make sure you are not using a robot token and try again.'
      );
    }

    Log.warn(
      'This command is not yet implemented. It will create a new project, but it will not be fully configured.'
    );
    Log.log(`👋 Welcome to Expo, ${actor.username}!`);
    Log.newLine();

    const targetProjectDirInput =
      await this.getTargetProjectDirectoryAsync(targetProjectDirFromArgs);
    const finalTargetProjectDirectory = await this.cloneTemplateAsync(targetProjectDirInput);
    await this.installProjectDependenciesAsync(finalTargetProjectDirectory);
    await this.initializeGitRepositoryAsync(finalTargetProjectDirectory);
    await this.initializeProjectAsync(graphqlClient, actor, finalTargetProjectDirectory);

    Log.log('🎉 We finished creating your new project.');
    Log.newLine();
  }

  private async getTargetProjectDirectoryAsync(targetProjectDirFromArgs: string): Promise<string> {
    Log.log(
      `🚚 Let's start by cloning the default Expo template project from GitHub and installing dependencies.`
    );
    Log.newLine();
    let targetProjectDirInput = targetProjectDirFromArgs;
    if (!targetProjectDirInput) {
      targetProjectDirInput = (
        await promptAsync({
          type: 'text',
          name: 'targetProjectDir',
          message: 'Where would you like to create your new project directory?',
          initial: path.join(process.cwd(), 'new-expo-project'),
        })
      ).targetProjectDir;
    }

    return targetProjectDirInput;
  }

  private async cloneTemplateAsync(targetProjectDirInput: string): Promise<string> {
    const githubUsername = 'expo';
    const githubRepositoryName = 'expo-template-default';

    Log.log(`📂 Cloning the project to ${targetProjectDirInput}`);
    Log.newLine();

    const cloneMethod = (await canAccessRepositoryUsingSshAsync({
      githubUsername,
      githubRepositoryName,
    }))
      ? 'ssh'
      : 'https';
    Log.log(chalk.dim(`We detected that ${cloneMethod} is your preferred git clone method`));
    Log.newLine();

    const { targetProjectDir: finalTargetProjectDirectory } = await runGitCloneAsync({
      githubUsername,
      githubRepositoryName,
      targetProjectDir: targetProjectDirInput,
      cloneMethod,
    });

    return finalTargetProjectDirectory;
  }

  private async installProjectDependenciesAsync(
    finalTargetProjectDirectory: string
  ): Promise<void> {
    const packageManager = await promptForPackageManagerAsync();
    await installDependenciesAsync({
      projectDir: finalTargetProjectDirectory,
      packageManager,
    });
  }

  private async initializeGitRepositoryAsync(finalTargetProjectDirectory: string): Promise<void> {
    await fs.remove(path.join(finalTargetProjectDirectory, '.git'));
    await runCommandAsync({
      cwd: finalTargetProjectDirectory,
      command: 'git',
      args: ['init'],
    });
    Log.log();
    await runCommandAsync({
      cwd: finalTargetProjectDirectory,
      command: 'git',
      args: ['add', '.'],
    });

    await runCommandAsync({
      cwd: finalTargetProjectDirectory,
      command: 'git',
      args: ['commit', '-m', 'Initial commit'],
    });
  }

  private async initializeProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    actor: Actor,
    projectDir: string
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
      } else {
        const choices = this.getAccountChoices(
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

    const projectName = getActorUsername(actor) + '-app';
    const projectFullName = `@${accountName}/${projectName}`;
    const existingProjectIdOnServer = await findProjectIdByAccountNameAndSlugNullableAsync(
      graphqlClient,
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

      await this.saveProjectIdAndLogSuccessAsync(projectDir, existingProjectIdOnServer);
      return existingProjectIdOnServer;
    }

    if (!accountNamesWhereUserHasSufficientPermissionsToCreateApp.has(accountName)) {
      throw new Error(
        `You don't have permission to create a new project on the ${accountName} account and no matching project already exists on the account.`
      );
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

    await this.saveProjectIdAndLogSuccessAsync(projectDir, createdProjectId);
    return createdProjectId;
  }

  private async saveProjectIdAndLogSuccessAsync(
    projectDir: string,
    projectId: string
  ): Promise<void> {
    const exp = await getPrivateExpoConfigAsync(projectDir, { skipPlugins: true });
    const result = await createOrModifyExpoConfigAsync(
      projectDir,
      {
        extra: { ...exp.extra, eas: { ...exp.extra?.eas, projectId } },
      },
      { skipSDKVersionRequirement: true }
    );

    switch (result.type) {
      case 'success':
        Log.withTick(
          `Project successfully linked (ID: ${chalk.bold(projectId)}) (modified app.json)`
        );
        break;
      case 'fail':
        throw new Error(result.message);
      default:
        throw new Error('Unexpected result type from modifyConfigAsync');
    }
  }

  private getAccountChoices(actor: Actor, namesWithSufficientPermissions: Set<string>): Choice[] {
    const allAccounts = actor.accounts;

    const sortedAccounts =
      actor.__typename === 'Robot'
        ? allAccounts
        : [...allAccounts].sort((a, _b) =>
            actor.__typename === 'User' ? (a.name === actor.username ? -1 : 1) : 0
          );

    if (actor.__typename !== 'Robot') {
      return sortedAccounts.map(account => {
        const isPersonalAccount = actor.__typename === 'User' && account.name === actor.username;
        const accountDisplayName = isPersonalAccount
          ? `${account.name} (personal account)`
          : account.name;
        const disabled = !namesWithSufficientPermissions.has(account.name);

        return {
          title: accountDisplayName,
          value: { name: account.name },
          ...(disabled && {
            disabled: true,
            description:
              'You do not have the required permissions to create projects on this account.',
          }),
        };
      });
    }

    return sortedAccounts.map(account => ({
      title: account.name,
      value: { name: account.name },
    }));
  }
}
