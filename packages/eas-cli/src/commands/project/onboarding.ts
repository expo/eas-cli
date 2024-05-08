import { Platform } from '@expo/eas-build-job';

import { reviewAndCommitChangesAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { validateOrSetProjectIdAsync } from '../../commandUtils/context/contextUtils/getProjectIdAsync';
import { CredentialsContextProjectInfo } from '../../credentials/context';
import { SetUpBuildCredentialsCommandAction } from '../../credentials/manager/SetUpBuildCredentialsCommandAction';
import { AppPlatform, OnboardingDeviceType, OnboardingEnvironment } from '../../graphql/generated';
import { UserPreferencesMutation } from '../../graphql/mutations/UserPreferencesMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import { runGitCloneAsync, runGitPushAsync } from '../../onboarding/git';
import { installDependenciesAsync } from '../../onboarding/installDependencies';
import { ExpoConfigOptions, getPrivateExpoConfig } from '../../project/expoConfig';
import { confirmAsync } from '../../prompts';
import { Actor } from '../../user/User';
import GitClient from '../../vcs/clients/git';

export default class Onboarding extends EasCommand {
  static override hidden = true;

  static override aliases = ['init:onboarding', 'onboarding'];

  static override description = 'continue onboarding process started on the expo.dev website';

  static override flags = {};

  static override args = [{ name: 'TARGET_PROJECT_DIRECTORY' }];

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
  };

  async runAsync(): Promise<void> {
    const {
      args: { TARGET_PROJECT_DIRECTORY: targetProjectDirInput },
    } = await this.parse(Onboarding);

    const {
      loggedIn: { actor, graphqlClient },
      analytics,
    } = await this.getContextAsync(Onboarding, {
      nonInteractive: false,
    });

    if (actor.__typename === 'Robot') {
      throw new Error(
        'This command is not available for robot users. Make sure you are not using a robot token and try again.'
      );
    }

    if (!actor.preferences.onboarding) {
      throw new Error(
        'This command can only be run as part of the onboarding process started on the Expo website. Visit https://expo.new to start a new project.'
      );
    }

    if (!actor.preferences.onboarding.platform) {
      throw new Error(
        'This command can only be run as part of the onboarding process started on the Expo website. It seems like you started an onboarding process, but we are missing some information needed to be filled in before running the eas init:onboarding command (selected platform). Continue the onboarding process on the Expo website.'
      );
    }
    if (!actor.preferences.onboarding.environment) {
      throw new Error(
        'This command can only be run as part of the onboarding process started on the Expo website. It seems like you started an onboarding process, but we are missing some information needed to be filled in before running the eas init:onboarding command (selected environment). Continue the onboarding process on the Expo website.'
      );
    }
    if (!actor.preferences.onboarding.deviceType) {
      throw new Error(
        'This command can only be run as part of the onboarding process started on the Expo website. It seems like you started an onboarding process, but we are missing some information needed to be filled in before running the eas init:onboarding command (selected device type). Continue the onboarding process on the Expo website.'
      );
    }

    const platform =
      actor.preferences.onboarding.platform === AppPlatform.Android
        ? Platform.ANDROID
        : Platform.IOS;

    const app = await AppQuery.byIdAsync(graphqlClient, actor.preferences.onboarding.appId);

    const githubUsername = app.githubRepository
      ? app.githubRepository.metadata.githubRepoOwnerName
      : 'expo';
    const githubRepositoryName = app.githubRepository
      ? app.githubRepository.metadata.githubRepoName
      : 'expo-default-template';
    const initialTargetProjectDir = targetProjectDirInput ?? `./${githubRepositoryName}`;

    Log.log(`👋 Welcome to Expo, ${actor.username}!`);
    Log.log('🚀 We will continue your onboarding process in EAS CLI');
    Log.log();
    Log.log(
      `🔎 Let's start by cloning ${
        app.githubRepository
          ? `your project (${githubUsername}/${githubRepositoryName})`
          : `default expo template project (${githubUsername}/${githubRepositoryName})`
      } from GitHub and installing dependencies.`
    );
    Log.log();
    const shouldContinue = await confirmAsync({ message: 'Do you want to continue?' });
    if (!shouldContinue) {
      throw new Error("Aborting, run the command again once you're ready.");
    }

    const { targetProjectDir } = await runGitCloneAsync({
      githubUsername,
      githubRepositoryName,
      targetProjectDir: initialTargetProjectDir,
    });

    const vcsClient = new GitClient(targetProjectDir);
    await installDependenciesAsync({
      projectDir: targetProjectDir,
    });
    await vcsClient.trackFileAsync('package-lock.json');

    const shouldSetupCredentials =
      actor.preferences.onboarding.deviceType === OnboardingDeviceType.Device &&
      actor.preferences.onboarding.environment === OnboardingEnvironment.DevBuild;
    if (shouldSetupCredentials) {
      Log.log('🔑 Now we need to set up build credentials for your project:');
      await new SetUpBuildCredentialsCommandAction(
        actor,
        graphqlClient,
        vcsClient,
        analytics,
        await getPrivateExpoConfigWithProjectIdAsync({
          projectDir: targetProjectDir,
          graphqlClient,
          actor,
        }),
        getDynamicPrivateProjectConfigGetter({
          projectDir: targetProjectDir,
          graphqlClient,
          actor,
        }),
        platform,
        'development',
        targetProjectDir
      ).runAsync();
    }

    if (await vcsClient.hasUncommittedChangesAsync()) {
      Log.log(
        '📦 We will now commit the changes made by the configuration process and push them to GitHub:'
      );
      Log.log();
      Log.log('🔍 Checking for changes in the repository...');
      await vcsClient.showChangedFilesAsync();
      await reviewAndCommitChangesAsync(
        vcsClient,
        `[eas-onboarding] Install dependencies${
          shouldSetupCredentials ? 'and set up build credentials' : ''
        }`,
        { nonInteractive: false }
      );
      Log.log('📤 Pushing changes to GitHub...');
      await runGitPushAsync({
        targetProjectDir,
      });
    }

    await UserPreferencesMutation.markCliDoneInOnboardingUserPreferencesAsync(graphqlClient, {
      appId: app.id,
    });

    Log.log();
    Log.log('🎉 We finished configuring your project.');
    Log.log('🚀 You can now go back to the website to continue.');
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
  const expBefore = getPrivateExpoConfig(projectDir, options);
  const projectId = await validateOrSetProjectIdAsync({
    exp: expBefore,
    graphqlClient,
    actor,
    options: {
      nonInteractive: false,
    },
  });
  const exp = getPrivateExpoConfig(projectDir, options);
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
