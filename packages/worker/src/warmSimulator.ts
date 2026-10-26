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
  let hasStartupScript = true;
  try {
    await fs.access('/Volumes/My Shared Files/expo-startup/startup.sh');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    hasStartupScript = false;
  }
  const env = { ...process.env, ...job.builderEnvironment?.env };
  let launcherVersion: unknown;
  let state: { bootUuid?: unknown; status?: unknown } | undefined;
  let hasState = false;
  try {
    const contents = await fs.readFile('/tmp/expo-simulator-startup.json', 'utf8');
    hasState = true;
    const parsed = JSON.parse(contents);
    state = parsed;
    launcherVersion = parsed?.launcherVersion;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw error;
    }
    // Unknown state uses latest; only the launcher can confirm that cleanup finished.
  }
  if (!hasStartupScript && !hasState) {
    return;
  }
  if (typeof state?.bootUuid === 'string' && (!hasStartupScript || state.status === 'disabled')) {
    const boot = (
      await spawn('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { stdio: 'pipe' })
    ).stdout.trim();
    if (!boot) {
      throw new Error(
        'Could not read the VM boot identifier; Simulator cleanup cannot be confirmed.'
      );
    }
    const isCurrentBoot = state.bootUuid === boot;
    if ((isCurrentBoot && state.status === 'disabled') || (!isCurrentBoot && !hasStartupScript)) {
      return;
    }
  }
  const manager = resolveConfiguredPackageManager(env, PackageManager.BUN);
  const version =
    typeof launcherVersion === 'string' && launcherVersion ? launcherVersion : 'latest';
  const { command, args } = resolvePackageExec(manager, [
    ...(version !== 'latest' && manager === PackageManager.BUN ? ['--no-install'] : []),
    `@expo/simulator-launcher@${version}`,
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
      !failure.stderr?.includes("Could not find an existing 'simulator-launcher' binary") ||
      !failure.stderr.includes('--no-install')
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
