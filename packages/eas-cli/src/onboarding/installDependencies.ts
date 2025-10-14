import { runCommandAsync } from './runCommand';
import { selectAsync } from '../prompts';

export const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm', 'yarn'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export async function promptForPackageManagerAsync(): Promise<PackageManager> {
  return await selectAsync(
    'Which package manager would you like to use?',
    PACKAGE_MANAGERS.map(manager => ({ title: manager, value: manager })),
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
    hideOutput: true,
  });
}
