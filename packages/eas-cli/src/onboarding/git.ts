import { runCommandAsync } from './runCommand';

export async function runGitCloneAsync({
  targetProjectDir,
  githubRepositoryName,
  githubUsername,
}: {
  githubUsername: string;
  githubRepositoryName: string;
  targetProjectDir: string;
}): Promise<void> {
  const args = [
    'clone',
    `git@github.com:${githubUsername}/${githubRepositoryName}.git`,
    targetProjectDir,
  ];
  await runCommandAsync({
    args,
    command: 'git',
    shouldPrintStderrLineAsStdout: line => {
      return line.includes('Cloning into');
    },
  });
}

export async function runGitPushAsync({
  targetProjectDir,
}: {
  targetProjectDir: string;
}): Promise<void> {
  const args = ['push'];
  await runCommandAsync({
    args,
    command: 'git',
    cwd: targetProjectDir,
  });
}
