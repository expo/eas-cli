import { PackageManager } from './packageManagers';
import { runCommandAsync } from './runCommand';

export async function installDependenciesAsync({
  projectDir,
  packageManager,
}: {
  projectDir: string;
  packageManager: PackageManager;
}): Promise<void> {
  // TODO: add support for other package managers
  await runCommandAsync({
    command: packageManager,
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
