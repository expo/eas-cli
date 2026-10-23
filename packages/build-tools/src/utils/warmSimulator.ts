import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from './packageManager';

/** Stop warmup through the launcher CLI and await its cleanup acknowledgement. */
export async function stopWarmSimulatorAsync(
  logger?: bunyan,
  env: BuildStepEnv = process.env
): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }
  const { command, args } = resolvePackageExec(
    resolveConfiguredPackageManager(env, PackageManager.BUN),
    ['@expo/simulator-launcher@latest', 'stop']
  );
  await spawn(command, args, { env, logger, stdio: 'pipe', timeout: 150_000 });
}
