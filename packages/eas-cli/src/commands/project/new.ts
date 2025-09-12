import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { AppVersionSource, EasJson } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { getEASUpdateURL, getExpoWebsiteBaseUrl } from '../../api';
import { runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import { reviewAndCommitChangesAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { validateOrSetProjectIdAsync } from '../../commandUtils/context/contextUtils/getProjectIdAsync';
import { CredentialsContextProjectInfo } from '../../credentials/context';
import { SetUpBuildCredentialsCommandAction } from '../../credentials/manager/SetUpBuildCredentialsCommandAction';
import {
  AppFragment,
  AppPlatform,
  OnboardingDeviceType,
  OnboardingEnvironment,
  Role,
} from '../../graphql/generated';
import { UserPreferencesMutation } from '../../graphql/mutations/UserPreferencesMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log, { learnMore, link } from '../../log';
import {
  canAccessRepositoryUsingSshAsync,
  runGitCloneAsync,
  runGitPushAsync,
} from '../../onboarding/git';
import { installDependenciesAsync } from '../../onboarding/installDependencies';
import { runCommandAsync } from '../../onboarding/runCommand';
import { RequestedPlatform } from '../../platform';
import { ExpoConfigOptions, getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { Actor } from '../../user/User';
import { easCliVersion } from '../../utils/easCli';
import GitClient from '../../vcs/clients/git';
import { Choice, confirmAsync, promptAsync } from '../../prompts';
import nullthrows from 'nullthrows';
import ora from 'ora';
import { getProjectDashboardUrl } from '../../build/utils/url';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import ProjectInit from './init';

type InitializeMethodOptions = {
  force: boolean;
  nonInteractive: boolean;
};

export default class New extends EasCommand {
  static override aliases = ['new'];

  static override description = "create a new project set up with Expo's services.";

  static override flags = {};

  static override args = [{ name: 'TARGET_PROJECT_DIRECTORY' }];

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
  };

  async runAsync(): Promise<void> {
    const {
      args: { TARGET_PROJECT_DIRECTORY: targetProjectDirInput },
    } = await this.parse(New);

    const {
      loggedIn: { actor, graphqlClient },
      analytics,
    } = await this.getContextAsync(New, {
      nonInteractive: false,
    });

    if (actor.__typename === 'Robot') {
      throw new Error(
        'This command is not available for robot users. Make sure you are not using a robot token and try again.'
      );
    }

    // if (!actor.preferences.onboarding) {
    //   throw new Error(
    //     'This command can only be run as part of the onboarding process started on the Expo website. Visit https://expo.new to start a new project.'
    //   );
    // }

    // if (!actor.preferences.onboarding.platform) {
    //   throw new Error(
    //     'This command can only be run as part of the onboarding process started on the Expo website. It seems like you started an onboarding process, but we are missing some information needed to be filled in before running the eas init:onboarding command (selected platform). Continue the onboarding process on the Expo website.'
    //   );
    // }
    // if (!actor.preferences.onboarding.environment) {
    //   throw new Error(
    //     'This command can only be run as part of the onboarding process started on the Expo website. It seems like you started an onboarding process, but we are missing some information needed to be filled in before running the eas init:onboarding command (selected environment). Continue the onboarding process on the Expo website.'
    //   );
    // }
    // if (!actor.preferences.onboarding.deviceType) {
    //   throw new Error(
    //     'This command can only be run as part of the onboarding process started on the Expo website. It seems like you started an onboarding process, but we are missing some information needed to be filled in before running the eas init:onboarding command (selected device type). Continue the onboarding process on the Expo website.'
    //   );
    // }

    // if (
    //   new Date(actor.preferences.onboarding.lastUsed) < new Date(Date.now() - 1000 * 60 * 60 * 24)
    // ) {
    //   Log.warn(
    //     'It seems like you started an onboarding process, but it has been a while since you last used it. If you want to start a new onboarding process, visit https://expo.new.'
    //   );
    //   Log.log();
    // }

    // const platform =
    //   actor.preferences.onboarding.platform === AppPlatform.Android
    //     ? Platform.ANDROID
    //     : Platform.IOS;

    // const app = await AppQuery.byIdAsync(graphqlClient, actor.preferences.onboarding.appId);

    // const githubUsername = app.githubRepository
    //   ? app.githubRepository.metadata.githubRepoOwnerName
    //   : 'expo';
    // const githubRepositoryName = app.githubRepository
    //   ? app.githubRepository.metadata.githubRepoName
    //   : 'expo-template-default';

    Log.log(`👋 Welcome to Expo, ${actor.username}!`);
    Log.log();
    Log.log(`Creating new project...`);
    // Log.log(
    //   `🚚 Let's start by cloning ${
    //     app.githubRepository
    //       ? `your project (${githubUsername}/${githubRepositoryName})`
    //       : `default Expo template project (${githubUsername}/${githubRepositoryName})`
    //   } from GitHub and installing dependencies.`
    // );
    Log.log();

    let initialTargetProjectDirectory: string;

    if (targetProjectDirInput) {
      initialTargetProjectDirectory = targetProjectDirInput;
      Log.log(`📂 Cloning the project to ${initialTargetProjectDirectory}`);
    } else {
      const { selectedTargetProjectDirectory } = await promptAsync({
        type: 'text',
        name: 'selectedTargetProjectDirectory',
        message: '📂 Where would you like to create your new project directory?',
        initial: path.join(process.cwd(), `my-app`),
      });
      initialTargetProjectDirectory = selectedTargetProjectDirectory;

      // TODO: need to clone the project before creating the app id.

      const testing = await New.initializeWithoutExplicitIDAsync(
        graphqlClient,
        actor,
        initialTargetProjectDirectory,
        {
          force: false,
          nonInteractive: false,
        }
      );
      Log.log(testing);
    }
    Log.log('done!');

    // const cloneMethod = (await canAccessRepositoryUsingSshAsync({
    //   githubUsername,
    //   githubRepositoryName,
    // }))
    //   ? 'ssh'
    //   : 'https';
    // Log.log(chalk.dim(`We detected that ${cloneMethod} is your preffered git clone method`));
    // Log.log();

    // const { targetProjectDir: finalTargetProjectDirectory } = await runGitCloneAsync({
    //   githubUsername,
    //   githubRepositoryName,
    //   targetProjectDir: initialTargetProjectDirectory,
    //   cloneMethod,
    // });

    // const vcsClient = new GitClient({
    //   maybeCwdOverride: finalTargetProjectDirectory,
    //   requireCommit: false,
    // });
    // if (!app.githubRepository) {
    //   await fs.remove(path.join(finalTargetProjectDirectory, '.git'));
    //   await runCommandAsync({
    //     cwd: finalTargetProjectDirectory,
    //     command: 'git',
    //     args: ['init'],
    //   });
    //   Log.log();
    //   await configureProjectFromBareDefaultExpoTemplateAsync({
    //     app,
    //     vcsClient,
    //     targetDir: finalTargetProjectDirectory,
    //   });
    // }

  //   await installDependenciesAsync({
  //     projectDir: finalTargetProjectDirectory,
  //   });
  //   const exp = await getPrivateExpoConfigWithProjectIdAsync({
  //     projectDir: finalTargetProjectDirectory,
  //     graphqlClient,
  //     actor,
  //   });
  //   const getDynamicProjectConfigFn = getDynamicPrivateProjectConfigGetter({
  //     projectDir: finalTargetProjectDirectory,
  //     graphqlClient,
  //     actor,
  //   });

  //   if (!app.githubRepository) {
  //     await runCommandAsync({
  //       cwd: finalTargetProjectDirectory,
  //       command: 'npx',
  //       args: ['expo', 'install', 'expo-updates'],
  //     });
  //     Log.log();
  //     await runCommandAsync({
  //       cwd: finalTargetProjectDirectory,
  //       command: 'npx',
  //       args: ['expo', 'install', 'expo-insights'],
  //     });
  //     Log.log();
  //     await runCommandAsync({
  //       cwd: finalTargetProjectDirectory,
  //       command: 'npx',
  //       args: ['expo', 'install', 'expo-dev-client'],
  //     });
  //     Log.log();
  //   }
  //   await vcsClient.trackFileAsync('package-lock.json');

  //   const shouldSetupCredentials =
  //     ((platform === Platform.IOS &&
  //       actor.preferences.onboarding.deviceType === OnboardingDeviceType.Device) ||
  //       platform === Platform.ANDROID) &&
  //     actor.preferences.onboarding.environment === OnboardingEnvironment.DevBuild;
  //   if (shouldSetupCredentials) {
  //     Log.log('🔑 Now we need to set up build credentials for your project:');
  //     await new SetUpBuildCredentialsCommandAction(
  //       actor,
  //       graphqlClient,
  //       vcsClient,
  //       analytics,
  //       exp,
  //       getDynamicProjectConfigFn,
  //       platform,
  //       actor.preferences.onboarding.deviceType === OnboardingDeviceType.Simulator
  //         ? 'development-simulator'
  //         : 'development',
  //       finalTargetProjectDirectory
  //     ).runAsync();
  //   }

  //   if (app.githubRepository && (await vcsClient.hasUncommittedChangesAsync())) {
  //     Log.log(
  //       '📦 We will now commit the changes made by the configuration process and push them to GitHub:'
  //     );
  //     Log.log();
  //     Log.log('🔍 Checking for changes in the repository...');
  //     await vcsClient.showChangedFilesAsync();
  //     await reviewAndCommitChangesAsync(
  //       vcsClient,
  //       `[eas-onboarding] Install dependencies${
  //         shouldSetupCredentials ? ' and set up build credentials' : ''
  //       }`,
  //       { nonInteractive: false }
  //     );
  //     Log.log('📤 Pushing changes to GitHub...');
  //     await runGitPushAsync({
  //       targetProjectDir: finalTargetProjectDirectory,
  //     });
  //   } else if (!app.githubRepository) {
  //     await runCommandAsync({
  //       cwd: finalTargetProjectDirectory,
  //       command: 'git',
  //       args: ['add', '.'],
  //     });
  //     Log.log();
  //     await runCommandAsync({
  //       cwd: finalTargetProjectDirectory,
  //       command: 'git',
  //       args: ['commit', '-m', 'Initial commit'],
  //     });
  //     Log.log();
  //   }

  //   Log.log();
  //   Log.log('🎉 We finished configuring your project.');
  //   Log.log();
  //   if (
  //     !!app.githubRepository ||
  //     actor.preferences.onboarding.environment === OnboardingEnvironment.ExpoGo
  //   ) {
  //     Log.log('🚀 You can now go back to the website to continue:');
  //     const url = new URL(
  //       `/onboarding/develop/set-up-project-on-your-machine?project=${app.slug}&accountId=${app.ownerAccount.id}`,
  //       getExpoWebsiteBaseUrl()
  //     ).toString();
  //     Log.log(`👉 ${link(url)}`);
  //   } else {
  //     Log.log('🚀 Now we are going to trigger your first build');
  //     Log.log();
  //     const { buildIds } = await runBuildAndSubmitAsync({
  //       graphqlClient,
  //       analytics,
  //       vcsClient,
  //       projectDir: finalTargetProjectDirectory,
  //       flags: {
  //         nonInteractive: true,
  //         requestedPlatform:
  //           platform === Platform.ANDROID ? RequestedPlatform.Android : RequestedPlatform.Ios,
  //         profile:
  //           actor.preferences.onboarding.deviceType === OnboardingDeviceType.Simulator
  //             ? 'development-simulator'
  //             : 'development',
  //         wait: false,
  //         clearCache: false,
  //         json: false,
  //         autoSubmit: false,
  //         localBuildOptions: {},
  //         freezeCredentials: false,
  //       },
  //       actor,
  //       // eslint-disable-next-line async-protect/async-suffix
  //       getDynamicPrivateProjectConfigAsync: getDynamicProjectConfigFn,
  //     });
  //     const buildId = buildIds[0];
  //     Log.log();
  //     Log.log('🚀 You can now go back to the website to continue:');
  //     const url = new URL(
  //       `/onboarding/develop/set-up-project-on-your-machine?project=${app.slug}&accountId=${app.ownerAccount.id}&buildId=${buildId}`,
  //       getExpoWebsiteBaseUrl()
  //     ).toString();
  //     Log.log(`👉 ${link(url)}`);
  //   }

  //   const { __typename, ...previousPreferences } = actor.preferences.onboarding;
  //   await UserPreferencesMutation.markCliDoneInOnboardingUserPreferencesAsync(graphqlClient, {
  //     ...previousPreferences,
  //     appId: app.id,
  //   });
  // }

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
        const choices = New.getAccountChoices(
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

      await New.saveProjectIdAndLogSuccessAsync(projectDir, existingProjectIdOnServer);
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

    await New.saveProjectIdAndLogSuccessAsync(projectDir, createdProjectId);
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


  private static async saveProjectIdAndLogSuccessAsync(
    projectDir: string,
    projectId: string
  ): Promise<void> {
    await saveProjectIdToAppConfigAsync(projectDir, projectId);
    Log.withTick(`Project successfully linked (ID: ${chalk.bold(projectId)}) (modified app.json)`);
  }
}

// we can't get this automated by using command context because when we run a command the project directory doesn't exist yet
async function getPrivateExpoConfigWithProjectIdAsync({
  projectDir,
  graphqlClient,
  actor,
  options,
}: {
  projectDir: string;
  graphqlClient: ExpoGraphqlClient;
  actor: Actor;
  options?: ExpoConfigOptions;
}): Promise<CredentialsContextProjectInfo> {
  const expBefore = await getPrivateExpoConfigAsync(projectDir, options);
  const projectId = await validateOrSetProjectIdAsync({
    exp: expBefore,
    graphqlClient,
    actor,
    options: {
      nonInteractive: false,
    },
    cwd: projectDir,
  });
  const exp = await getPrivateExpoConfigAsync(projectDir, options);
  return {
    exp,
    projectId,
  };
}

// we can't get this automated by using command context because when we run a command the project directory doesn't exist yet
function getDynamicPrivateProjectConfigGetter({
  projectDir,
  graphqlClient,
  actor,
}: {
  projectDir: string;
  graphqlClient: ExpoGraphqlClient;
  actor: Actor;
}): DynamicConfigContextFn {
  return async (options?: ExpoConfigOptions) => {
    return {
      ...(await getPrivateExpoConfigWithProjectIdAsync({
        projectDir,
        graphqlClient,
        actor,
        options,
      })),
      projectDir,
    };
  };
}

async function configureProjectFromBareDefaultExpoTemplateAsync({
  app,
  vcsClient,
  targetDir,
}: {
  app: AppFragment;
  vcsClient: GitClient;
  targetDir: string;
}): Promise<void> {
  // Android package name requires each component to start with a lowercase letter.
  const isUsernameValidSegment = /^[^a-z]/.test(app.ownerAccount.name);
  const userPrefix = isUsernameValidSegment ? 'user' : '';
  const isSlugValidSegment = /^[^a-z]/.test(app.slug);
  const slugPrefix = isSlugValidSegment ? 'app' : '';

  const bundleIdentifier = `com.${userPrefix}${stripInvalidCharactersForBundleIdentifier(
    app.ownerAccount.name
  )}.${slugPrefix}${stripInvalidCharactersForBundleIdentifier(app.slug)}`;
  const updateUrl = getEASUpdateURL(app.id, /* manifestHostOverride */ null);

  const easBuildGitHubConfig = {
    android: {
      image: 'latest',
    },
    ios: {
      image: 'latest',
    },
  };

  const easJson: EasJson = {
    cli: {
      version: `>= ${easCliVersion}`,
      appVersionSource: AppVersionSource.REMOTE,
    },
    build: {
      development: {
        developmentClient: true,
        distribution: 'internal',
        ...easBuildGitHubConfig,
      },
      'development-simulator': {
        extends: 'development',
        ios: {
          simulator: true,
        },
      },
      preview: {
        distribution: 'internal',
        channel: 'main',
        ...easBuildGitHubConfig,
      },
      production: {
        channel: 'production',
        autoIncrement: true,
        ...easBuildGitHubConfig,
      },
    },
    submit: {
      production: {},
    },
  };

  const easJsonPath = path.join(targetDir, 'eas.json');
  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  await vcsClient.trackFileAsync(easJsonPath);
  Log.log(
    `✅ Generated ${chalk.bold('eas.json')}. ${learnMore(
      'https://docs.expo.dev/build-reference/eas-json/'
    )}`
  );
  Log.log();

  const baseExpoConfig = JSON.parse(await fs.readFile(path.join(targetDir, 'app.json'), 'utf8'))
    .expo as ExpoConfig;

  const expoConfig: ExpoConfig = {
    ...baseExpoConfig,
    name: app.name ?? app.slug,
    slug: app.slug,
    extra: {
      eas: {
        projectId: app.id,
      },
    },
    owner: app.ownerAccount.name,
    updates: {
      url: updateUrl,
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    ios: {
      ...baseExpoConfig.ios,
      bundleIdentifier,
    },
    android: {
      ...baseExpoConfig.android,
      package: bundleIdentifier,
    },
  };

  const appJsonPath = path.join(targetDir, 'app.json');
  await fs.writeFile(appJsonPath, `${JSON.stringify({ expo: expoConfig }, null, 2)}\n`);
  await vcsClient.trackFileAsync(appJsonPath);
  Log.log(
    `✅ Generated ${chalk.bold('app.json')}. ${learnMore(
      'https://docs.expo.dev/versions/latest/config/app/'
    )}`
  );
  Log.log();
}

function stripInvalidCharactersForBundleIdentifier(string: string): string {
  return string.replaceAll(/[^A-Za-z0-9]/g, '');
}
