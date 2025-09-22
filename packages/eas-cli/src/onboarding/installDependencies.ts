import { runCommandAsync } from './runCommand';
import { selectAsync } from '../prompts';

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export async function promptForPackageManagerAsync(): Promise<PackageManager> {
  return await selectAsync(
    'Which package manager would you like to use?',
    [
      { title: 'npm', value: 'npm' },
      { title: 'Yarn', value: 'yarn' },
      { title: 'pnpm', value: 'pnpm' },
    ],
    { initial: 'npm' }
  );
}

export async function installDependenciesAsync({
  projectDir,
  packageManager = 'npm',
}: {
  projectDir: string;
  packageManager?: PackageManager;
}): Promise<void> {
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
        !(line === packageManager)
      );
    },
  });
}

export function getLockFileName(packageManager: PackageManager): string {
  const lockFileNameMap = {
    yarn: 'yarn.lock',
    pnpm: 'pnpm-lock.yaml',
    npm: 'package-lock.json',
  };

  return lockFileNameMap[packageManager];
}
