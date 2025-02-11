import * as PackageManagerUtils from '@expo/package-manager';
import spawnAsync from '@expo/spawn-async';
import { Errors } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
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
import { EASIGNORE_FILENAME, Ignore, makeShallowCopyAsync } from '../local';
import { Client } from '../vcs';

export default class GitClient extends Client {
  private readonly maybeCwdOverride?: string;
  public requireCommit: boolean;

  constructor(options: { maybeCwdOverride?: string; requireCommit: boolean }) {
    super();
    this.maybeCwdOverride = options.maybeCwdOverride;
    this.requireCommit = options.requireCommit;
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
    const repoRoot = PackageManagerUtils.resolveWorkspaceRoot(cwd) ?? cwd;
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

  public override async isCommitRequiredAsync(): Promise<boolean> {
    if (!this.requireCommit) {
      return false;
    }

    return await this.hasUncommittedChangesAsync();
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    if (await this.isCommitRequiredAsync()) {
      // it should already be checked before this function is called, but in case it wasn't
      // we want to ensure that any changes were introduced by call to `setGitCaseSensitivityAsync`
      throw new Error('You have some uncommitted changes in your repository.');
    }

    const rootPath = await this.getRootPathAsync();

    let gitRepoUri;
    if (process.platform === 'win32') {
      // getRootDirectoryAsync() will return C:/path/to/repo on Windows and path
      // prefix should be file:///
      gitRepoUri = `file:///${rootPath}`;
    } else {
      // getRootDirectoryAsync() will /path/to/repo, and path prefix should be
      // file:/// so only file:// needs to be prepended
      gitRepoUri = `file://${rootPath}`;
    }

    await assertEnablingGitCaseSensitivityDoesNotCauseNewUncommittedChangesAsync(rootPath);

    const isCaseSensitive = await isGitCaseSensitiveAsync(rootPath);
    try {
      await setGitCaseSensitivityAsync(true, rootPath);
      await spawnAsync(
        'git',
        [
          'clone',
          // If we do not require a commit, we are going to later
          // copy the working directory into the destination path,
          // so we can skip the checkout step (which also adds files
          // that have been removed in the working directory).
          this.requireCommit ? null : '--no-checkout',
          '--no-hardlinks',
          '--depth',
          '1',
          gitRepoUri,
          destinationPath,
        ].flatMap(e => e ?? []),
        { cwd: rootPath }
      );

      const sourceEasignorePath = path.join(rootPath, EASIGNORE_FILENAME);
      if (await fs.exists(sourceEasignorePath)) {
        Log.debug('.easignore exists, deleting files that should be ignored', {
          sourceEasignorePath,
        });

        const cachedFilesWeShouldHaveIgnored = (
          await spawnAsync(
            'git',
            [
              'ls-files',
              '--exclude-from',
              sourceEasignorePath,
              // `--ignored --cached` makes git print files that should be
              // ignored by rules from `--exclude-from`, but instead are currently cached.
              '--ignored',
              '--cached',
              // separates file names with null characters
              '-z',
            ],
            { cwd: destinationPath }
          )
        ).stdout
          .split('\0')
          // ls-files' output is terminated by a null character
          .filter(file => file !== '');

        Log.debug('cachedFilesWeShouldHaveIgnored', {
          cachedFilesWeShouldHaveIgnored,
        });

        await Promise.all(
          cachedFilesWeShouldHaveIgnored.map(file =>
            // `ls-files` does not go over files within submodules. If submodule is
            // ignored, it is listed as a single path, so we need to `rm -rf` it.
            fs.rm(path.join(destinationPath, file), { recursive: true, force: true })
          )
        );

        // Special-case `.git` which `git ls-files` will never consider ignored.
        const ignore = await Ignore.createAsync(rootPath);
        if (ignore.ignores('.git')) {
          await fs.rm(path.join(destinationPath, '.git'), { recursive: true, force: true });
          Log.debug('deleted .git', {
            destinationPath,
          });
        }
      }
    } finally {
      await setGitCaseSensitivityAsync(isCaseSensitive, rootPath);
    }

    if (!this.requireCommit) {
      Log.debug('making shallow copy', { requireCommit: this.requireCommit });
      // After we create the shallow Git copy, we copy the files
      // again. This way we include the changed and untracked files
      // (`git clone` only copies the committed changes).
      //
      // We only do this if `requireCommit` is false because `requireCommit: true`
      // setups expect no changes in files (e.g. locked files should remain locked).
      await makeShallowCopyAsync(rootPath, destinationPath);
    } else {
      Log.debug('not making shallow copy', { requireCommit: this.requireCommit });
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

  /** NOTE: This method does not support checking whether `.git` is ignored by `.easignore` rules. */
  public override async isFileIgnoredAsync(filePath: string): Promise<boolean> {
    const rootPath = await this.getRootPathAsync();

    let isTracked: boolean;
    try {
      await spawnAsync('git', ['ls-files', '--error-unmatch', filePath], {
        cwd: rootPath,
      });
      isTracked = true;
    } catch {
      isTracked = false;
    }

    const easIgnorePath = path.join(rootPath, EASIGNORE_FILENAME);
    if (await fs.exists(easIgnorePath)) {
      const ignore = await Ignore.createAsync(rootPath);
      const wouldNotBeCopiedToClone = ignore.ignores(filePath);
      const wouldBeDeletedFromClone =
        (
          await spawnAsync(
            'git',
            ['ls-files', '--exclude-from', easIgnorePath, '--ignored', '--cached', filePath],
            { cwd: rootPath }
          )
        ).stdout.trim() !== '';

      // File is considered ignored if:
      // - makeShallowCopyAsync() will not copy it to the clone
      // AND
      // - it will not be copied to the clone because it's not tracked
      // - or it will get copied to the clone, but then will be deleted by .easignore rules
      return wouldNotBeCopiedToClone && (!isTracked || wouldBeDeletedFromClone);
    }

    if (isTracked) {
      return false; // Tracked files aren't ignored even if they match ignore patterns
    }

    try {
      await spawnAsync('git', ['check-ignore', '-q', filePath], { cwd: rootPath });
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

async function assertEnablingGitCaseSensitivityDoesNotCauseNewUncommittedChangesAsync(
  cwd: string
): Promise<void> {
  // Remember uncommited changes before case sensitivity change
  // for later comparison so we log to the user only the files
  // that were marked as changed after the case sensitivity change.
  const uncommittedChangesBeforeCaseSensitivityChange = await gitStatusAsync({
    showUntracked: true,
    cwd,
  });

  const isCaseSensitive = await isGitCaseSensitiveAsync(cwd);
  await setGitCaseSensitivityAsync(true, cwd);
  try {
    const uncommitedChangesAfterCaseSensitivityChange = await gitStatusAsync({
      showUntracked: true,
      cwd,
    });

    if (
      uncommitedChangesAfterCaseSensitivityChange !== uncommittedChangesBeforeCaseSensitivityChange
    ) {
      const baseUncommitedChangesSet = new Set(
        uncommittedChangesBeforeCaseSensitivityChange.split('\n')
      );

      const errorMessage = [
        'Detected inconsistent filename casing between your local filesystem and git.',
        'This will likely cause your job to fail. Impacted files:',
        ...uncommitedChangesAfterCaseSensitivityChange.split('\n').flatMap(changedFile => {
          // This file was changed before the case sensitivity change too.
          if (baseUncommitedChangesSet.has(changedFile)) {
            return [];
          }
          return [changedFile];
        }),
        `Resolve filename casing inconsistencies before proceeding. ${learnMore(
          'https://expo.fyi/macos-ignorecase'
        )}`,
      ];

      throw new Error(errorMessage.join('\n'));
    }
  } finally {
    await setGitCaseSensitivityAsync(isCaseSensitive, cwd);
  }
}
