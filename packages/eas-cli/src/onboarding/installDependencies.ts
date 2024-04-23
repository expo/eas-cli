import { runCommandAsync } from './runCommand';

export async function installDependenciesAsync({
  projectDir,
}: {
  projectDir: string;
}): Promise<void> {
  // TODO: add support for other package managers
  await runCommandAsync({
    command: 'npm',
    args: ['install'],
    cwd: projectDir,
    shouldShowStderrLine: line => {
      return (
        !line.includes('WARN') &&
        !line.includes('deprecated') &&
        !line.includes('no longer maintained') &&
        !line.includes('has been moved') &&
        !(line === 'npm')
      );
    },
  });
}
