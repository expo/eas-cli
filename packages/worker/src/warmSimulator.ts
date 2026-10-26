import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '@expo/build-tools';
import { type Job } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

/** Stop warmup before ordinary setup unless this job opts into warm Simulator adoption. */
export async function maybeStopWarmSimulatorAsync(job: Job): Promise<void> {
  if (
    process.platform !== 'darwin' ||
    job.builderEnvironment?.env?.EAS_USE_WARM_SIMULATOR === '1'
  ) {
    return;
  }
  try {
    await fs.access('/Volumes/My Shared Files/expo-startup/startup.sh');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  const env = { ...process.env, ...job.builderEnvironment?.env };
  let launcherVersion: unknown;
  try {
    launcherVersion = JSON.parse(
      await fs.readFile('/tmp/expo-simulator-startup.json', 'utf8')
    )?.launcherVersion;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw error;
    }
    // Unknown state uses latest; only the launcher can confirm that cleanup finished.
  }
  const { command, args } =
    typeof launcherVersion === 'string' && launcherVersion
      ? {
          command: 'bun',
          args: ['x', '--no-install', `@expo/simulator-launcher@${launcherVersion}`, 'stop'],
        }
      : resolvePackageExec(resolveConfiguredPackageManager(env, PackageManager.BUN), [
          '@expo/simulator-launcher@latest',
          'stop',
        ]);
  try {
    await spawn(command, args, { env, stdio: 'pipe', timeout: 150_000 });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    if (
      !args.includes('--no-install') ||
      failure.status !== 1 ||
      failure.stdout !== '' ||
      failure.stderr?.trim() !==
        "error: Could not find an existing 'simulator-launcher' binary to run. Stopping because --no-install was passed."
    ) {
      throw error;
    }
    await spawn(
      command,
      args.filter(arg => arg !== '--no-install'),
      { env, stdio: 'pipe', timeout: 150_000 }
    );
  }
}
