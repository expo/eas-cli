import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';
import tar from 'tar';
import { v4 as uuidv4 } from 'uuid';

import Log from '../../log';
import { confirmAsync, promptAsync } from '../../prompts';
import { formatBytes } from '../../utils/files';
import {
  doesGitRepoExistAsync,
  getGitDiffOutputAsync,
  gitDiffAsync,
  gitRootDirectoryAsync,
  gitStatusAsync,
  isGitInstalledAsync,
} from '../../utils/git';
import { getTmpDirectory } from '../../utils/paths';
import { endTimer, formatMilliseconds, startTimer } from '../../utils/timer';

async function ensureGitRepoExistsAsync(): Promise<void> {
  if (!(await isGitInstalledAsync())) {
    throw new Error('git command not found, install it before proceeding');
  }

  if (await doesGitRepoExistAsync()) {
    return;
  }

  Log.warn("It looks like you haven't initialized the git repository yet.");
  Log.warn('EAS Build requires you to use a git repository for your project.');

  const confirmInit = await confirmAsync({
    message: `Would you like to run 'git init' in the current directory?`,
  });
  if (!confirmInit) {
    throw new Error(
      'A git repository is required for building your project. Initialize it and run this command again.'
    );
  }
  await spawnAsync('git', ['init']);

  Log.log("We're going to make an initial commit for you repository.");

  await commitPromptAsync({ initialCommitMessage: 'Initial commit', commitAllFiles: true });
}

async function isGitStatusCleanAsync(): Promise<boolean> {
  const changes = await gitStatusAsync({ showUntracked: true });
  return changes.length === 0;
}

async function maybeBailOnGitStatusAsync(): Promise<void> {
  if (await isGitStatusCleanAsync()) {
    return;
  }
  Log.addNewLineIfNone();
  Log.warn(`${chalk.bold('Warning!')} Your git working tree is dirty.`);
  Log.log(
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

async function ensureGitStatusIsCleanAsync(nonInteractive = false): Promise<void> {
  if (await isGitStatusCleanAsync()) {
    return;
  }
  Log.addNewLineIfNone();
  Log.warn(`${chalk.bold('Warning!')} Your git working tree is dirty.`);
  Log.log(
    `This operation needs to be run on a clean working tree, please ${chalk.bold(
      'commit all your changes before proceeding'
    )}.`
  );
  if (nonInteractive) {
    throw new Error('Please commit all changes. Aborting...');
  }
  const answer = await confirmAsync({
    message: `Commit changes to git?`,
  });
  if (answer) {
    await commitPromptAsync({ commitAllFiles: true });
  } else {
    throw new Error('Please commit all changes. Aborting...');
  }
}

async function makeProjectTarballAsync(): Promise<{ path: string; size: number }> {
  const spinner = ora('Compressing project files');

  await fs.mkdirp(getTmpDirectory());
  const shallowClonePath = path.join(getTmpDirectory(), `${uuidv4()}-shallow-clone`);
  const tarPath = path.join(getTmpDirectory(), `${uuidv4()}.tar.gz`);

  // If the compression takes longer then a second, show the spinner.
  // This can happen when the user has a lot of resources or doesn't ignore their CocoaPods.
  // A basic project on a Mac can compress in roughly ~40ms.
  // A fairly complex project without CocoaPods ignored can take up to 30s.
  const timer = setTimeout(
    () => {
      spinner.start();
    },
    Log.isDebug ? 1 : 1000
  );
  // TODO: Possibly warn after more time about unoptimized assets.
  const compressTimerLabel = 'makeProjectTarballAsync';
  startTimer(compressTimerLabel);

  try {
    await spawnAsync('git', [
      'clone',
      '--no-hardlinks',
      '--depth',
      '1',
      await getGitRootFullPathAsync(),
      shallowClonePath,
    ]);
    await tar.create({ cwd: shallowClonePath, file: tarPath, prefix: 'project', gzip: true }, [
      '.',
    ]);
  } catch (err) {
    clearTimeout(timer);
    if (spinner.isSpinning) {
      spinner.fail();
    }
    throw err;
  } finally {
    await fs.remove(shallowClonePath);
  }
  clearTimeout(timer);

  const { size } = await fs.stat(tarPath);
  const duration = endTimer(compressTimerLabel);
  if (spinner.isSpinning) {
    const prettyTime = formatMilliseconds(duration);
    spinner.succeed(
      `Compressed project files ${chalk.dim(`${prettyTime} (${formatBytes(size)})`)}`
    );
  }

  return { size, path: tarPath };
}

async function getGitRootFullPathAsync() {
  if (process.platform === 'win32') {
    // getRootDirectoryAsync() will return C:/path/to/repo on Windows and path
    // prefix should be file:///
    return `file:///${await gitRootDirectoryAsync()}`;
  } else {
    // getRootDirectoryAsync() will /path/to/repo, and path prefix should be
    // file:/// so only file:// needs to be prepended
    return `file://${await gitRootDirectoryAsync()}`;
  }
}

async function showDiffAsync() {
  const outputTooLarge = (await getGitDiffOutputAsync()).split(/\r\n|\r|\n/).length > 100;
  await gitDiffAsync({ withPager: outputTooLarge });
}

async function commitPromptAsync({
  initialCommitMessage,
  commitAllFiles,
}: {
  initialCommitMessage?: string;
  commitAllFiles?: boolean;
} = {}): Promise<void> {
  const { message } = await promptAsync({
    type: 'text',
    name: 'message',
    message: 'Commit message:',
    initial: initialCommitMessage,
    validate: (input: string) => input !== '',
  });
  if (commitAllFiles) {
    await spawnAsync('git', ['add', '-A']);
  }
  await commitChangedFilesAsync(message);
}

async function commitChangedFilesAsync(message: string): Promise<void> {
  await spawnAsync('git', ['add', '-u']);
  await spawnAsync('git', ['commit', '-m', message]);
}

export {
  isGitStatusCleanAsync,
  showDiffAsync,
  commitPromptAsync,
  commitChangedFilesAsync,
  ensureGitRepoExistsAsync,
  ensureGitStatusIsCleanAsync,
  maybeBailOnGitStatusAsync,
  makeProjectTarballAsync,
};
