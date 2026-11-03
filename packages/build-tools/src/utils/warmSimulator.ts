import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import { createInterface } from 'node:readline';

import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from './packageManager';

/**
 * Runs a Simulator launcher command with the version that `start` recorded, which warmup cached.
 * Stdout can contain credentials, so only fixed startup progress from stderr is logged.
 */
export async function runSimulatorLauncherAsync(
  launcherArgs: string[],
  { env, signal, logger }: { env: BuildStepEnv; signal?: AbortSignal; logger?: bunyan }
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
  const child = spawn(command, args, { env, stdio: 'pipe', signal, timeout: 425_000 });
  if (logger && child.child?.stderr) {
    // Read complete lines: stream chunks can split a progress message anywhere.
    createInterface({ input: child.child.stderr }).on('line', line => {
      if (
        /^Warm Simulator (?:is still starting; waiting \(\d+s elapsed, 420s limit\)|became ready after waiting \d+s)\.$/.test(
          line
        )
      ) {
        logger.info(line);
      }
    });
  }
  const { stdout } = await child;
  return stdout;
}

/** Stops warmup; resolves only after the launcher confirms cleanup. */
export async function stopWarmSimulatorAsync(env: BuildStepEnv): Promise<void> {
  if (process.platform === 'darwin') {
    await runSimulatorLauncherAsync(['stop'], { env });
  }
}
