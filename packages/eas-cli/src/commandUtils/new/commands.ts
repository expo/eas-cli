import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { printDirectory } from './utils';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../onboarding/git';
import { PackageManager, installDependenciesAsync } from '../../onboarding/installDependencies';
import { runCommandAsync } from '../../onboarding/runCommand';
import { ora } from '../../ora';
import { expoCommandAsync } from '../../utils/expoCli';

export async function cloneTemplateAsync(targetProjectDir: string): Promise<string> {
  const githubUsername = 'expo';
  const githubRepositoryName = 'expo-template-default';

  const spinner = ora(
    `${chalk.bold(`Cloning the project to ${printDirectory(targetProjectDir)}`)}`
  ).start();

  const cloneMethod = (await canAccessRepositoryUsingSshAsync({
    githubUsername,
    githubRepositoryName,
  }))
    ? 'ssh'
    : 'https';

  const { targetProjectDir: finalTargetProjectDirectory } = await runGitCloneAsync({
    githubUsername,
    githubRepositoryName,
    targetProjectDir,
    cloneMethod,
    showOutput: false,
  });

  spinner.succeed(`Cloned the project to ${printDirectory(finalTargetProjectDirectory)}`);

  return finalTargetProjectDirectory;
}

export async function installProjectDependenciesAsync(
  projectDir: string,
  packageManager: PackageManager
): Promise<void> {
  const spinner = ora(`${chalk.bold('Installing project dependencies')}`).start();
  await installDependenciesAsync({
    outputLevel: 'none',
    projectDir,
    packageManager,
  });

  const dependencies = ['expo-updates', '@expo/metro-runtime'];
  spinner.text = `Installing ${dependencies.map(dep => chalk.bold(dep)).join(', ')}`;
  await expoCommandAsync(projectDir, ['install', ...dependencies], { silent: true });
  spinner.succeed(`Installed project dependencies`);
}

export async function initializeGitRepositoryAsync(projectDir: string): Promise<void> {
  const spinner = ora(`${chalk.bold('Initializing Git repository')}`).start();
  await fs.remove(path.join(projectDir, '.git'));

  const commands = [['init'], ['add', '.'], ['commit', '-m', 'Initial commit']];

  for (const args of commands) {
    await runCommandAsync({
      cwd: projectDir,
      command: 'git',
      args,
      showOutput: false,
      showSpinner: false,
    });
  }
  spinner.succeed(`Initialized Git repository`);
}
