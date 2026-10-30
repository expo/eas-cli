import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '@expo/build-tools/dist/utils/packageManager';
import { type Job } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

/** Request warmup shutdown unless this job opts into warm Simulator adoption. */
export async function maybeStopWarmSimulatorAsync(job: Job): Promise<void> {
  if (
    process.platform !== 'darwin' ||
    job.builderEnvironment?.env?.EAS_USE_WARM_SIMULATOR === '1'
  ) {
    return;
  }
  const warmupFiles = await Promise.all(
    ['/usr/local/share/vm-tools/startup.sh', '/tmp/expo-simulator-startup.json'].map(file =>
      fs.access(file).then(
        () => true,
        error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
          }
          throw error;
        }
      )
    )
  );
  if (!warmupFiles.some(Boolean)) {
    return;
  }
  const env = { ...process.env, ...job.builderEnvironment?.env };
  const { command, args } = resolvePackageExec(
    resolveConfiguredPackageManager(env, PackageManager.BUN),
    ['@expo/simulator-launcher@latest', 'stop']
  );
  await spawn(command, args, { env, stdio: 'pipe', timeout: 150_000 });
}
