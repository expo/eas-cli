import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../onboarding/git';
import { installDependenciesAsync } from '../../onboarding/installDependencies';
import { runCommandAsync } from '../../onboarding/runCommand';
import GitClient from '../../vcs/clients/git';

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
      args: { TARGET_PROJECT_DIRECTORY: targetProjectDirInput },
    } = await this.parse(New);

    const {
      loggedIn: { actor },
    } = await this.getContextAsync(New, { nonInteractive: false });
    const githubUsername = 'expo';
    const githubRepositoryName = 'expo-template-default';

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
    Log.log(
      `🚚 Let's start by cloning the default Expo template project from GitHub and installing dependencies.`
    );
    Log.newLine();
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

    const vcsClient = new GitClient({
      maybeCwdOverride: targetProjectDirInput,
      requireCommit: false,
    });

    await fs.remove(path.join(finalTargetProjectDirectory, '.git'));
    await runCommandAsync({
      cwd: finalTargetProjectDirectory,
      command: 'git',
      args: ['init'],
    });
    Log.log();
    // TODO - need to create an app
    // await configureProjectFromBareDefaultExpoTemplateAsync({
    //   app,
    //   vcsClient,
    //   targetDir: finalTargetProjectDirectory,
    // });

    await installDependenciesAsync({
      projectDir: finalTargetProjectDirectory,
    });
    await vcsClient.trackFileAsync('package-lock.json');

    await runCommandAsync({
      cwd: finalTargetProjectDirectory,
      command: 'git',
      args: ['add', '.'],
    });
    Log.newLine();
    await runCommandAsync({
      cwd: finalTargetProjectDirectory,
      command: 'git',
      args: ['commit', '-m', 'Initial commit'],
    });
    Log.newLine();
    Log.log('🎉 We finished creating your new project.');
    Log.newLine();
  }
}
