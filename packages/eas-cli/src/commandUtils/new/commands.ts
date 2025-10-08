import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import Log from '../../log';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../onboarding/git';
import { PackageManager, installDependenciesAsync } from '../../onboarding/installDependencies';
import { runCommandAsync } from '../../onboarding/runCommand';

export async function cloneTemplateAsync(targetProjectDir: string): Promise<string> {
  const githubUsername = 'expo';
  const githubRepositoryName = 'expo-template-default';

  Log.log(`📂 Cloning the project to ${targetProjectDir}`);
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
    targetProjectDir,
    cloneMethod,
  });

  return finalTargetProjectDirectory;
}

export async function installProjectDependenciesAsync(
  projectDir: string,
  packageManager: PackageManager
): Promise<void> {
  await installDependenciesAsync({
    projectDir,
    packageManager,
  });

  const dependencies = ['expo-updates', '@expo/metro-runtime'];
  for (const dependency of dependencies) {
    await runCommandAsync({
      cwd: projectDir,
      command: 'npx',
      args: ['expo', 'install', dependency],
    });
  }
}

export async function initializeGitRepositoryAsync(projectDir: string): Promise<void> {
  await fs.remove(path.join(projectDir, '.git'));

  const commands = [['init'], ['add', '.'], ['commit', '-m', 'Initial commit']];

  for (const args of commands) {
    await runCommandAsync({
      cwd: projectDir,
      command: 'git',
      args,
    });
    Log.log();
  }
}
