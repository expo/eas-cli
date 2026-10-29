import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';

import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from './packageManager';

/**
 * Runs a Simulator launcher command with the version that `start` recorded, which warmup cached.
 * The output can contain credentials, so it is returned and never logged.
 */
export async function runSimulatorLauncherAsync(
  launcherArgs: string[],
  { env, signal }: { env: BuildStepEnv; signal?: AbortSignal }
): Promise<string> {
  const version = await fs
    .readFile('/tmp/expo-simulator-startup.json', 'utf8')
    .then(text => JSON.parse(text).launcherVersion)
    .catch(() => undefined);
  const { command, args } = resolvePackageExec(
    resolveConfiguredPackageManager(env, PackageManager.BUN),
    [
      `@expo/simulator-launcher@${typeof version === 'string' ? version : 'latest'}`,
      ...launcherArgs,
    ]
  );
  const { stdout } = await spawn(command, args, { env, stdio: 'pipe', signal, timeout: 425_000 });
  return stdout;
}

/** Stops warmup; resolves only after the launcher confirms cleanup. */
export async function stopWarmSimulatorAsync(env: BuildStepEnv): Promise<void> {
  if (process.platform === 'darwin') {
    await runSimulatorLauncherAsync(['stop'], { env });
  }
}
