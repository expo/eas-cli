import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '@expo/build-tools';
import { type Job } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

/** Stop warmup before ordinary setup unless this job opts into warm Simulator adoption. */
export async function maybeStopWarmSimulatorAsync(job: Job): Promise<void> {
  if (
    process.platform !== 'darwin' ||
    job.builderEnvironment?.env?.EAS_USE_WARM_SIMULATOR === '1'
  ) {
    return;
  }
  const env = { ...process.env, ...job.builderEnvironment?.env };
  const { command, args } = resolvePackageExec(
    resolveConfiguredPackageManager(env, PackageManager.BUN),
    ['@expo/simulator-launcher@latest', 'stop']
  );
  await spawn(command, args, { env, stdio: 'pipe', timeout: 150_000 });
}
