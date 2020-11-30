import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import log from '../../log';
import { confirmAsync, promptAsync } from '../../prompts';
import {
  doesGitRepoExistAsync,
  gitDiffAsync,
  gitRootDirectoryAsync,
  gitStatusAsync,
  isGitInstalledAsync,
} from '../../utils/git';
import { getTmpDirectory } from '../../utils/paths';

async function ensureGitRepoExistsAsync(): Promise<void> {
  if (!(await isGitInstalledAsync())) {
    throw new Error('git command not found, install it before proceeding');
  }

  if (await doesGitRepoExistAsync()) {
    return;
  }

  log.warn("It looks like you haven't initialized the git repository yet.");
  log.warn('EAS Build requires you to use a git repository for your project.');

  const confirmInit = await confirmAsync({
    message: `Would you like to run 'git init' in the current directory?`,
  });
  if (!confirmInit) {
    throw new Error(
      'A git repository is required for building your project. Initialize it and run this command again.'
    );
  }
  await spawnAsync('git', ['init']);

  log("We're going to make an initial commit for you repository.");

  await spawnAsync('git', ['add', '-A']);
  await commitPromptAsync('Initial commit');
}

async function isGitStatusCleanAsync(): Promise<boolean> {
  const changes = await gitStatusAsync();
  return changes.length === 0;
}

async function maybeBailOnGitStatusAsync(): Promise<void> {
  if (!(await isGitStatusCleanAsync())) {
    log.warn(`${chalk.bold('Warning!')} Your git working tree is dirty.`);
    log(
      `It's recommended to ${chalk.bold(
        'commit all your changes before proceeding'
      )}, so you can revert the changes made by this command if necessary.`
    );
    const answer = await confirmAsync({
      message: `Would you like to proceed?`,
    });

    if (!answer) {
      throw new Error('Please commit all changes. Aborting...');
    }
  }
}

async function ensureGitStatusIsCleanAsync(): Promise<void> {
  if (!(await isGitStatusCleanAsync())) {
    log.warn(`${chalk.bold('Warning!')} Your git working tree is dirty.`);
    log(
      `It's recommended to ${chalk.bold(
        'commit all your changes before proceeding'
      )}, so you can revert the changes made by this command if necessary.`
    );
    const answer = await confirmAsync({
      message: `Would you like to commit your local changes?`,
    });
    if (answer) {
      await commitPromptAsync();
    } else {
      throw new Error('Please commit all changes. Aborting...');
    }
  }
}

async function makeProjectTarballAsync(): Promise<{ path: string; size: number }> {
  const spinner = ora('Making project tarball').start();

  await fs.mkdirp(getTmpDirectory());
  const tarPath = path.join(getTmpDirectory(), `${uuidv4()}.tar.gz`);

  await spawnAsync(
    'git',
    ['archive', '--format=tar.gz', '--prefix', 'project/', '-o', tarPath, 'HEAD'],
    { cwd: await gitRootDirectoryAsync() }
  );
  spinner.succeed('Project tarball created.');

  const { size } = await fs.stat(tarPath);
  return { size, path: tarPath };
}

async function reviewAndCommitChangesAsync(
  commitMessage: string,
  { nonInteractive }: { nonInteractive: boolean }
): Promise<void> {
  if (nonInteractive) {
    throw new Error(
      'Cannot commit changes when --non-interactive is specified. Run the command in interactive mode to review and commit changes.'
    );
  }

  log('Please review the following changes and pass the message to make the commit.');
  log.newLine();
  await gitDiffAsync();
  log.newLine();

  const confirm = await confirmAsync({
    message: 'Can we commit these changes for you?',
  });

  if (!confirm) {
    throw new Error('Aborting commit. Please review and commit the changes manually.');
  }
  await commitPromptAsync(commitMessage);
}

async function commitPromptAsync(initialCommitMessage?: string): Promise<void> {
  const { message } = await promptAsync({
    type: 'text',
    name: 'message',
    message: 'Commit message:',
    initial: initialCommitMessage,
    validate: (input: string) => input !== '',
  });

  // Add changed files only
  await spawnAsync('git', ['add', '-u']);
  await spawnAsync('git', ['commit', '-m', message]);
}

export {
  isGitStatusCleanAsync,
  ensureGitRepoExistsAsync,
  ensureGitStatusIsCleanAsync,
  maybeBailOnGitStatusAsync,
  makeProjectTarballAsync,
  reviewAndCommitChangesAsync,
};
