import { Platform } from '@expo/eas-build-job';

import { reviewAndCommitChangesAsync } from '../build/utils/repository';
import EasCommand from '../commandUtils/EasCommand';
import { DynamicConfigContextFn } from '../commandUtils/context/DynamicProjectConfigContextField';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { validateOrSetProjectIdAsync } from '../commandUtils/context/contextUtils/getProjectIdAsync';
import { CredentialsContextProjectInfo } from '../credentials/context';
import { SetUpBuildCredentialsCommandAction } from '../credentials/manager/SetUpBuildCredentialsCommandAction';
import Log from '../log';
import { runGitCloneAsync, runGitPushAsync } from '../onboarding/git';
import { installDependenciesAsync } from '../onboarding/installDependencies';
import { ExpoConfigOptions, getPrivateExpoConfig } from '../project/expoConfig';
import { Actor } from '../user/User';
import GitClient from '../vcs/clients/git';

export default class Onboarding extends EasCommand {
  static override description = 'start/continue onboarding process';

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

    const githubUsername = 'szdziedzic';
    const githubRepositoryName = 'testexpo';
    const targetProjectDir: string = targetProjectDirInput ?? `./${githubRepositoryName}`;
    const platform = Platform.IOS;

    const {
      loggedIn: { actor, graphqlClient },
      analytics,
    } = await this.getContextAsync(Onboarding, {
      nonInteractive: false,
    });

    Log.log('👋 Welcome to Expo!');
    Log.log('🚀 We will continue your onboarding process in EAS CLI');
    Log.log();
    Log.log("🔎 Let's start by cloning your project from GitHub and installing dependencies.");
    Log.log();

    await runGitCloneAsync({
      githubUsername,
      githubRepositoryName,
      targetProjectDir,
    });

    await installDependenciesAsync({
      projectDir: targetProjectDir,
    });

    const vcsClient = new GitClient(targetProjectDir);

    Log.log('🔑 Setting up build credentials for your project:');
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

    if (await vcsClient.hasUncommittedChangesAsync()) {
      Log.log(
        '📦 We will now commit the changes made by the configuration process and push them to GitHub:'
      );
      Log.log();
      Log.log('🔍 Checking for changes in the repository...');
      await vcsClient.showChangedFilesAsync();
      await reviewAndCommitChangesAsync(
        vcsClient,
        '[EAS onboarding] Install dependencies and set up build credentials',
        { nonInteractive: false }
      );
      Log.log('📤 Pushing changes to GitHub...');
      await runGitPushAsync({
        targetProjectDir,
      });
    }

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
}: {
  projectDir: string;
  graphqlClient: ExpoGraphqlClient;
  actor: Actor;
}): Promise<CredentialsContextProjectInfo> {
  const expBefore = getPrivateExpoConfig(projectDir);
  const projectId = await validateOrSetProjectIdAsync({
    exp: expBefore,
    graphqlClient,
    actor,
    options: {
      nonInteractive: false,
    },
  });
  const exp = getPrivateExpoConfig(projectDir);
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
      projectDir,
      projectId,
    };
  };
}
