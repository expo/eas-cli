import spawnAsync from '@expo/spawn-async';

import Log from '../log';
import { confirmAsync, promptAsync } from '../prompts';
import { Client } from './vcs';

export default class GitClient extends Client {
  public async ensureRepoExistsAsync(): Promise<void> {
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

    const { message } = await promptAsync({
      type: 'text',
      name: 'message',
      message: 'Commit message:',
      initial: 'Initial commit',
      validate: (input: string) => input !== '',
    });
    await this.commitAsync({ commitAllFiles: true, commitMessage: message });
  }

  public async commitAsync({
    commitMessage,
    commitAllFiles,
  }: {
    commitMessage: string;
    commitAllFiles?: boolean;
  }): Promise<void> {
    if (commitAllFiles) {
      await spawnAsync('git', ['add', '-A']);
    }

    await spawnAsync('git', ['add', '-u']);
    await spawnAsync('git', ['commit', '-m', commitMessage]);
  }

  public async hasUncommittedChangesAsync(): Promise<boolean> {
    const changes = await gitStatusAsync({ showUntracked: true });
    return changes.length !== 0;
  }

  public async getRootPathAsync(): Promise<string> {
    return (await spawnAsync('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    let gitRepoUri;
    if (process.platform === 'win32') {
      // getRootDirectoryAsync() will return C:/path/to/repo on Windows and path
      // prefix should be file:///
      gitRepoUri = `file:///${await this.getRootPathAsync()}`;
    } else {
      // getRootDirectoryAsync() will /path/to/repo, and path prefix should be
      // file:/// so only file:// needs to be prepended
      gitRepoUri = `file://${await this.getRootPathAsync()}`;
    }

    await spawnAsync('git', [
      'clone',
      '--no-hardlinks',
      '--depth',
      '1',
      gitRepoUri,
      destinationPath,
    ]);
  }

  public async getCommitHashAsync(): Promise<string | undefined> {
    try {
      return (await spawnAsync('git', ['rev-parse', 'HEAD'])).stdout.trim();
    } catch (err) {
      return undefined;
    }
  }

  public async trackFileAsync(file: string): Promise<void> {
    await spawnAsync('git', ['add', '--intent-to-add', file]);
  }

  public async getBranchNameAsync(): Promise<string | null> {
    try {
      return (await spawnAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    } catch (e) {
      return null;
    }
  }

  public async getLastCommitMessageAsync(): Promise<string | null> {
    try {
      return (await spawnAsync('git', ['--no-pager', 'log', '-1', '--pretty=%B'])).stdout.trim();
    } catch (e) {
      return null;
    }
  }

  public async showDiffAsync() {
    const outputTooLarge = (await getGitDiffOutputAsync()).split(/\r\n|\r|\n/).length > 100;
    await gitDiffAsync({ withPager: outputTooLarge });
  }

  public async isFileUntrackedAsync(path: string): Promise<boolean> {
    const withUntrackedFiles = await gitStatusAsync({ showUntracked: true });
    const trackedFiles = await gitStatusAsync({ showUntracked: false });
    const pathWithoutLeadingDot = path.replace(/^\.\//, ''); // remove leading './' from path
    return (
      withUntrackedFiles.includes(pathWithoutLeadingDot) &&
      !trackedFiles.includes(pathWithoutLeadingDot)
    );
  }
}

async function isGitInstalledAsync(): Promise<boolean> {
  try {
    await spawnAsync('git', ['--help']);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  return true;
}

async function doesGitRepoExistAsync(): Promise<boolean> {
  try {
    await spawnAsync('git', ['rev-parse', '--git-dir']);
    return true;
  } catch (err) {
    return false;
  }
}

interface GitStatusOptions {
  showUntracked?: boolean;
}
async function gitStatusAsync({ showUntracked }: GitStatusOptions = {}): Promise<string> {
  return (await spawnAsync('git', ['status', '-s', showUntracked ? '-uall' : '-uno'])).stdout;
}

async function getGitDiffOutputAsync(): Promise<string> {
  return (await spawnAsync('git', ['--no-pager', 'diff'])).stdout;
}

async function gitDiffAsync({ withPager = false }: { withPager?: boolean } = {}): Promise<void> {
  const options = withPager ? [] : ['--no-pager'];
  await spawnAsync('git', [...options, 'diff'], { stdio: ['ignore', 'inherit', 'inherit'] });
}
