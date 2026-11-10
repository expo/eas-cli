import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { type ZodType, z } from 'zod';

import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from './packageManager';

/** Read one tool's prepared metadata; its consumer defines the schema and compatibility checks. */
export async function readPreparedSimulatorToolAsync<T>(
  tool: string,
  schema: ZodType<T>
): Promise<T | undefined> {
  const manifestPath = path.join(
    os.homedir(),
    'Library',
    'Caches',
    'expo-simulator-startup',
    'prepared.json'
  );
  try {
    const manifest = z
      .object({ tools: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
    return Object.hasOwn(manifest.tools, tool) ? schema.parse(manifest.tools[tool]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs a Simulator launcher command with the version that `start` recorded, which warmup cached.
 * The output can contain credentials, so it is returned and never logged.
 */
export async function runSimulatorLauncherAsync(
  launcherArgs: string[],
  { env, signal }: { env: BuildStepEnv; signal?: AbortSignal }
): Promise<string> {
  signal?.throwIfAborted();
  const contents = await fs
    .readFile('/tmp/expo-simulator-startup.json', 'utf8')
    .catch(async error => {
      if (
        error.code === 'ENOENT' &&
        launcherArgs[0] === 'claim' &&
        env.EAS_USE_WARM_SIMULATOR === '1' &&
        process.platform === 'darwin' &&
        os.uptime() < 300 &&
        (await fs.access('/usr/local/share/vm-tools/startup.sh').then(
          () => true,
          () => false
        ))
      ) {
        return await waitForLauncherStateFileAsync(signal);
      }
      return undefined;
    });
  let version: unknown;
  try {
    version = JSON.parse(contents ?? '{}').launcherVersion;
  } catch {}
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

/** A session request can arrive before startup writes launcher state. */
async function waitForLauncherStateFileAsync(signal?: AbortSignal): Promise<string> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    signal?.throwIfAborted();
    try {
      return await fs.readFile('/tmp/expo-simulator-startup.json', 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      // The claim caller must still stop warmup before it can start cold.
      throw new Error('Timed out waiting for the warm Simulator launcher to start.');
    }
    await sleepAsync(Math.min(250, remaining), undefined, { signal });
  }
}

/** Stops warmup; resolves only after the launcher confirms cleanup. */
export async function stopWarmSimulatorAsync(env: BuildStepEnv): Promise<void> {
  if (process.platform === 'darwin') {
    await runSimulatorLauncherAsync(['stop'], { env });
  }
}
