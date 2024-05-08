import { runCommandAsync } from './runCommand';
import Log from '../log';
import { confirmAsync, promptAsync } from '../prompts';

export async function runGitCloneAsync({
  targetProjectDir,
  githubRepositoryName,
  githubUsername,
}: {
  githubUsername: string;
  githubRepositoryName: string;
  targetProjectDir: string;
}): Promise<{
  targetProjectDir: string;
}> {
  try {
    await runCommandAsync({
      command: 'git',
      args: [
        'clone',
        `git@github.com:${githubUsername}/${githubRepositoryName}.git`,
        targetProjectDir,
      ],
      shouldPrintStderrLineAsStdout: line => {
        return line.includes('Cloning into');
      },
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
