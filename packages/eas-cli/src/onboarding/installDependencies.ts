import { runCommandAsync } from './runCommand';
import { selectAsync } from '../prompts';

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export async function promptForPackageManagerAsync(): Promise<PackageManager> {
  return await selectAsync(
    'Which package manager would you like to use?',
    (['bun', 'npm', 'pnpm', 'yarn'] as const).map(manager => ({ title: manager, value: manager })),
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
