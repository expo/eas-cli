import { runCommandAsync } from './runCommand';
import { selectAsync } from '../prompts';

export const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm', 'yarn'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export async function promptForPackageManagerAsync(): Promise<PackageManager> {
  return await selectAsync(
    'Which package manager would you like to use?',
    (['bun', 'npm', 'pnpm', 'yarn'] as const).map(manager => ({ title: manager, value: manager })),
    { initial: 'npm' }
  );
}

export async function installDependenciesAsync({
  outputLevel = 'default',
  projectDir,
  packageManager = 'npm',
}: {
  outputLevel?: 'default' | 'none';
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
    showOutput: outputLevel !== 'none',
    showSpinner: outputLevel !== 'none',
  });
}
