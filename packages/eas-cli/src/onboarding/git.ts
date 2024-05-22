import spawnAsync from '@expo/spawn-async';

import { runCommandAsync } from './runCommand';
import Log from '../log';
import { confirmAsync, promptAsync } from '../prompts';

export async function runGitCloneAsync({
  targetProjectDir,
  githubRepositoryName,
  githubUsername,
  cloneMethod,
}: {
  githubUsername: string;
  githubRepositoryName: string;
  targetProjectDir: string;
  cloneMethod: 'ssh' | 'https';
}): Promise<{
  targetProjectDir: string;
}> {
  const url =
    cloneMethod === 'ssh'
      ? `git@github.com:${githubUsername}/${githubRepositoryName}.git`
      : `https://github.com/${githubUsername}/${githubRepositoryName}.git`;
  try {
    await runCommandAsync({
      command: 'git',
      args: ['clone', url, targetProjectDir],
      shouldPrintStderrLineAsStdout: line => {
        return line.includes('Cloning into');
      },
      showSpinner: false,
    });
    return { targetProjectDir };
  } catch (error: any) {
    if (error.stderr.includes('already exists')) {
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
        cloneMethod,
      });
    } else if (error.stderr.includes('Permission denied')) {
      Log.warn(
        `It seems like you do not have permission to clone the repository using ${cloneMethod}.`
      );
      const newMethod = cloneMethod === 'ssh' ? 'https' : 'ssh';
      const shouldContinue = await confirmAsync({
        message: `Do you want to clone the repository using ${newMethod} instead?`,
      });
      if (!shouldContinue) {
        throw new Error('Permission denied. Aborting...');
      }
      return await runGitCloneAsync({
        githubRepositoryName,
        githubUsername,
        targetProjectDir,
        cloneMethod: newMethod,
      });
    } else {
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

export async function canAccessRepositoryUsingSshAsync({
  githubUsername,
  githubRepositoryName,
}: {
  githubUsername: string;
  githubRepositoryName: string;
}): Promise<boolean> {
  try {
    await spawnAsync('git', [
      'ls-remote',
      `git@github.com:${githubUsername}/${githubRepositoryName}.git`,
    ]);
    return true;
  } catch {
    return false;
  }
}
