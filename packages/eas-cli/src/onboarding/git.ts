import { runCommandAsync } from './runCommand';
import Log from '../log';
import { confirmAsync, promptAsync } from '../prompts';

export async function runGitCloneAsync({
  targetProjectDir,
  githubRepositoryName,
  githubUsername,
  useSsh = true,
}: {
  githubUsername: string;
  githubRepositoryName: string;
  targetProjectDir: string;
  useSsh?: boolean;
}): Promise<{
  targetProjectDir: string;
}> {
  const url = useSsh
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
      });
    } else if (useSsh && error.stderr.includes('Permission denied')) {
      Log.warn('It seems like you do not have permission to clone the repository using SSH.');
      const shouldContinue = await confirmAsync({
        message: 'Do you want to clone the repository using HTTPS instead?',
      });
      if (!shouldContinue) {
        throw new Error('Permission denied. Aborting...');
      }
      return await runGitCloneAsync({
        githubRepositoryName,
        githubUsername,
        targetProjectDir,
        useSsh: false,
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
