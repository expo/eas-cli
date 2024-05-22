import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';

import { runCommandAsync } from './runCommand';
import Log from '../log';
import { confirmAsync, promptAsync } from '../prompts';

export async function runGitCloneAsync({
  targetProjectDir,
  githubRepositoryName,
  githubUsername,
  useSsh = true,
  firstTry = true,
}: {
  githubUsername: string;
  githubRepositoryName: string;
  targetProjectDir: string;
  useSsh?: boolean;
  firstTry?: boolean;
}): Promise<{
  targetProjectDir: string;
}> {
  if (firstTry) {
    Log.log(
      `📥 Cloning ${chalk.bold(`${githubUsername}/${githubRepositoryName}`)} into ${chalk.bold(
        targetProjectDir
      )}...`
    );
  }
  const url = useSsh
    ? `git@github.com:${githubUsername}/${githubRepositoryName}.git`
    : `https://github.com/${githubUsername}/${githubRepositoryName}.git`;
  const wholeStderr: string[] = [];
  try {
    const spawnPromise = spawnAsync('git', ['clone', url, targetProjectDir], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const {
      child: { stdout, stderr },
    } = spawnPromise;
    if (!stdout || !stderr) {
      throw new Error(`Failed to spawn git clone`);
    }
    stdout.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        Log.log(`${chalk.gray(`[git]`)} ${line}`);
      }
    });

    stderr.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        wholeStderr.push(`${chalk.gray(`[git]`)} ${line}`);
      }
    });

    await spawnPromise;

    printFormattedStderr(wholeStderr);
    Log.log(
      `✅ ${chalk.bold(`${githubUsername}/${githubRepositoryName}`)} was cloned successfully.`
    );
    Log.log();
    return { targetProjectDir };
  } catch (error: any) {
    if (error.stderr.includes('already exists')) {
      printFormattedStderr(wholeStderr);
      Log.warn(`Directory ${targetProjectDir} already exists.`);
      const shouldContinue = await confirmAsync({
        message: 'Do you want to clone your project to some other destination?',
      });
      if (!shouldContinue) {
        throw new Error('Directory already exists. Aborting...');
      }
      const { newTargetProjectDir } = await promptAsync({
        type: 'text',
        name: 'newTargetProjectDir',
        message: 'New target directory path:',
        validate: (input: string) => input !== '',
      });
      return await runGitCloneAsync({
        githubRepositoryName,
        githubUsername,
        targetProjectDir: newTargetProjectDir,
        firstTry: false,
      });
    } else if (useSsh && error.stderr.includes('Permission denied')) {
      Log.debug('Failed to clone using SSH, trying HTTPS');
      return await runGitCloneAsync({
        githubRepositoryName,
        githubUsername,
        targetProjectDir,
        useSsh: false,
        firstTry: false,
      });
    } else {
      printFormattedStderr(wholeStderr);
      Log.error(`❌ ${chalk.bold(`git clone`)} failed`);
      throw error;
    }
  }
}

export async function runGitPushAsync({
  targetProjectDir,
}: {
  targetProjectDir: string;
}): Promise<void> {
  await runCommandAsync({
    command: 'git',
    args: ['push'],
    cwd: targetProjectDir,
  });
}

function printFormattedStderr(stderr: string[]): void {
  for (const line of stderr) {
    Log.warn(line);
  }
}
