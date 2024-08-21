import * as PackageManagerUtils from '@expo/package-manager';
import spawnAsync from '@expo/spawn-async';
import { Errors } from '@oclif/core';
import chalk from 'chalk';
import path from 'path';

import Log, { learnMore } from '../../log';
import { ora } from '../../ora';
import { confirmAsync, promptAsync } from '../../prompts';
import {
  doesGitRepoExistAsync,
  getGitDiffOutputAsync,
  gitDiffAsync,
  gitStatusAsync,
  isGitInstalledAsync,
} from '../git';
import { Client } from '../vcs';

export default class GitClient extends Client {
  constructor(private readonly maybeCwdOverride?: string) {
    super();
  }

  public override async ensureRepoExistsAsync(): Promise<void> {
    try {
      if (!(await isGitInstalledAsync())) {
        Log.error(
          `${chalk.bold('git')} command not found. Install it before proceeding or set ${chalk.bold(
            'EAS_NO_VCS=1'
          )} to use EAS CLI without Git (or any other version control system).`
        );
        Log.error(learnMore('https://expo.fyi/eas-vcs-workflow'));
        Errors.exit(1);
      }
    } catch (error: any) {
      Log.error(
        `${chalk.bold('git')} found, but ${chalk.bold(
          'git --help'
        )} exited with status ${error?.status}${error?.stderr ? `:` : '.'}`
      );

      if (error?.stderr) {
        Log.error(error?.stderr);
      }

      Log.error(
        `Repair your Git installation, or set ${chalk.bold(
          'EAS_NO_VCS=1'
        )} to use EAS CLI without Git (or any other version control system).`
      );
      Log.error(learnMore('https://expo.fyi/eas-vcs-workflow'));
      Errors.exit(1);
    }

    if (await doesGitRepoExistAsync(this.maybeCwdOverride)) {
      return;
    }

    Log.warn("It looks like you haven't initialized the git repository yet.");
    Log.warn('EAS requires you to use a git repository for your project.');

    const cwd = process.cwd();
    const repoRoot = PackageManagerUtils.findWorkspaceRoot(cwd) ?? cwd;
    const confirmInit = await confirmAsync({
      message: `Would you like us to run 'git init' in ${
        this.maybeCwdOverride ?? repoRoot
      } for you?`,
    });
    if (!confirmInit) {
      throw new Error(
        'A git repository is required for building your project. Initialize it and run this command again.'
      );
    }
    await spawnAsync('git', ['init'], { cwd: this.maybeCwdOverride ?? repoRoot });

    Log.log("We're going to make an initial commit for your repository.");

    const { message } = await promptAsync({
      type: 'text',
      name: 'message',
      message: 'Commit message:',
      initial: 'Initial commit',
      validate: (input: string) => input !== '',
    });
    await this.commitAsync({ commitAllFiles: true, commitMessage: message, nonInteractive: false });
  }

  public override async commitAsync({
    commitMessage,
    commitAllFiles,
    nonInteractive = false,
  }: {
    commitMessage: string;
    commitAllFiles?: boolean;
    nonInteractive: boolean;
  }): Promise<void> {
    await ensureGitConfiguredAsync({ nonInteractive });

    try {
      if (commitAllFiles) {
        await spawnAsync('git', ['add', '-A'], {
          cwd: this.maybeCwdOverride,
        });
      }
      await spawnAsync('git', ['add', '-u'], {
        cwd: this.maybeCwdOverride,
      });
      await spawnAsync('git', ['commit', '-m', commitMessage], {
        cwd: this.maybeCwdOverride,
      });
    } catch (err: any) {
      if (err?.stdout) {
        Log.error(err.stdout);
      }
      if (err?.stderr) {
        Log.error(err.stderr);
      }
      throw err;
    }
  }

  public override async isCommitRequiredAsync(): Promise<boolean> {
    return await this.hasUncommittedChangesAsync();
  }

  public override async showChangedFilesAsync(): Promise<void> {
    const gitStatusOutput = await gitStatusAsync({
      showUntracked: true,
      cwd: this.maybeCwdOverride,
    });
    Log.log(gitStatusOutput);
  }

  public override async hasUncommittedChangesAsync(): Promise<boolean> {
    const changes = await gitStatusAsync({ showUntracked: true, cwd: this.maybeCwdOverride });
    return changes.length > 0;
  }

  public async getRootPathAsync(): Promise<string> {
    return (
      await spawnAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: this.maybeCwdOverride,
      })
    ).stdout.trim();
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    if (await this.hasUncommittedChangesAsync()) {
      // it should already be checked before this function is called, but in case it wasn't
      // we want to ensure that any changes were introduced by call to `setGitCaseSensitivityAsync`
      throw new Error('You have some uncommitted changes in your repository.');
    }
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
    const isCaseSensitive = await isGitCaseSensitiveAsync(this.maybeCwdOverride);
    await setGitCaseSensitivityAsync(true, this.maybeCwdOverride);
    try {
      if (await this.hasUncommittedChangesAsync()) {
        Log.error('Detected inconsistent filename casing between your local filesystem and git.');
        Log.error('This will likely cause your build to fail. Impacted files:');
        await spawnAsync('git', ['status', '--short'], {
          stdio: 'inherit',
          cwd: this.maybeCwdOverride,
        });
        Log.newLine();
        Log.error(
          `Error: Resolve filename casing inconsistencies before proceeding. ${learnMore(
            'https://expo.fyi/macos-ignorecase'
          )}`
        );
        throw new Error('You have some uncommitted changes in your repository.');
      }
      await spawnAsync(
        'git',
        ['clone', '--no-hardlinks', '--depth', '1', gitRepoUri, destinationPath],
        {
          cwd: this.maybeCwdOverride,
        }
      );
    } finally {
      await setGitCaseSensitivityAsync(isCaseSensitive, this.maybeCwdOverride);
    }
  }

  public override async getCommitHashAsync(): Promise<string | undefined> {
    try {
      return (
        await spawnAsync('git', ['rev-parse', 'HEAD'], {
          cwd: this.maybeCwdOverride,
        })
      ).stdout.trim();
    } catch {
      return undefined;
    }
  }

  public override async trackFileAsync(file: string): Promise<void> {
    await spawnAsync('git', ['add', '--intent-to-add', file], {
      cwd: this.maybeCwdOverride,
    });
  }

  public override async getBranchNameAsync(): Promise<string | null> {
    try {
      return (
        await spawnAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: this.maybeCwdOverride,
        })
      ).stdout.trim();
    } catch {
      return null;
    }
  }

  public override async getLastCommitMessageAsync(): Promise<string | null> {
    try {
      return (
        await spawnAsync('git', ['--no-pager', 'log', '-1', '--pretty=%B'], {
          cwd: this.maybeCwdOverride,
        })
      ).stdout.trim();
    } catch {
      return null;
    }
  }

  public override async showDiffAsync(): Promise<void> {
    const outputTooLarge =
      (await getGitDiffOutputAsync(this.maybeCwdOverride)).split(/\r\n|\r|\n/).length > 100;
    await gitDiffAsync({ withPager: outputTooLarge, cwd: this.maybeCwdOverride });
  }

  public async isFileUntrackedAsync(path: string): Promise<boolean> {
    const withUntrackedFiles = await gitStatusAsync({
      showUntracked: true,
      cwd: this.maybeCwdOverride,
    });
    const trackedFiles = await gitStatusAsync({ showUntracked: false, cwd: this.maybeCwdOverride });
    const pathWithoutLeadingDot = path.replace(/^\.\//, ''); // remove leading './' from path
    return (
      withUntrackedFiles.includes(pathWithoutLeadingDot) &&
      !trackedFiles.includes(pathWithoutLeadingDot)
    );
  }

  public override async isFileIgnoredAsync(filePath: string): Promise<boolean> {
    try {
      await spawnAsync('git', ['check-ignore', '-q', filePath], {
        cwd: this.maybeCwdOverride ?? path.normalize(await this.getRootPathAsync()),
      });
      return true;
    } catch {
      return false;
    }
  }

  public override canGetLastCommitMessage(): boolean {
    return true;
  }
}

async function ensureGitConfiguredAsync({
  nonInteractive,
}: {
  nonInteractive: boolean;
}): Promise<void> {
  let usernameConfigured = true;
  let emailConfigured = true;
  try {
    await spawnAsync('git', ['config', '--get', 'user.name']);
  } catch (err: any) {
    Log.debug(err);
    usernameConfigured = false;
  }
  try {
    await spawnAsync('git', ['config', '--get', 'user.email']);
  } catch (err: any) {
    Log.debug(err);
    emailConfigured = false;
  }
  if (usernameConfigured && emailConfigured) {
    return;
  }

  Log.warn(
    `You need to configure Git with your ${[
      !usernameConfigured && 'username (user.name)',
      !emailConfigured && 'email address (user.email)',
    ]
      .filter(i => i)
      .join(' and ')}`
  );
  if (nonInteractive) {
    throw new Error('Git cannot be configured automatically in non-interactive mode');
  }
  if (!usernameConfigured) {
    const { username } = await promptAsync({
      type: 'text',
      name: 'username',
      message: 'Username:',
      validate: (input: string) => input !== '',
    });
    const spinner = ora(
      `Running ${chalk.bold(`git config --local user.name ${username}`)}`
    ).start();
    try {
      await spawnAsync('git', ['config', '--local', 'user.name', username]);
      spinner.succeed();
    } catch (err: any) {
      spinner.fail();
      throw err;
    }
  }
  if (!emailConfigured) {
    const { email } = await promptAsync({
      type: 'text',
      name: 'email',
      message: 'Email address:',
      validate: (input: string) => input !== '',
    });
    const spinner = ora(`Running ${chalk.bold(`git config --local user.email ${email}`)}`).start();
    try {
      await spawnAsync('git', ['config', '--local', 'user.email', email]);
      spinner.succeed();
    } catch (err: any) {
      spinner.fail();
      throw err;
    }
  }
}

/**
 * Checks if git is configured to be case sensitive
 * @returns {boolean | undefined}
 *    - boolean - is git case sensitive
 *    - undefined - case sensitivity is not configured and git is using default behavior
 */
export async function isGitCaseSensitiveAsync(
  cwd: string | undefined
): Promise<boolean | undefined> {
  if (process.platform !== 'darwin') {
    return undefined;
  }

  try {
    const result = await spawnAsync('git', ['config', '--get', 'core.ignorecase'], {
      cwd,
    });
    const isIgnoreCaseEnabled = result.stdout.trim();
    if (isIgnoreCaseEnabled === '') {
      return undefined;
    } else if (isIgnoreCaseEnabled === 'true') {
      return false;
    } else {
      return true;
    }
  } catch {
    return undefined;
  }
}

async function setGitCaseSensitivityAsync(
  enable: boolean | undefined,
  cwd: string | undefined
): Promise<void> {
  // we are assuming that if someone sets that on non-macos device then
  // they know what they are doing
  if (process.platform !== 'darwin') {
    return;
  }
  if (enable === undefined) {
    await spawnAsync('git', ['config', '--unset', 'core.ignorecase'], {
      cwd,
    });
  } else {
    await spawnAsync('git', ['config', 'core.ignorecase', String(!enable)], {
      cwd,
    });
  }
}
