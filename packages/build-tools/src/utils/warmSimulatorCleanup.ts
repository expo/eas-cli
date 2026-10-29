import { SystemError } from '@expo/eas-build-job';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { setTimeout as sleepAsync } from 'node:timers/promises';

const LAUNCHER_STATE_FILE = '/tmp/expo-simulator-startup.json';
const STARTUP_SCRIPT = '/usr/local/share/vm-tools/startup.sh';

/**
 * The worker stops warmup in the background for a job that does not use the warm Simulator. Wait
 * here, before the job changes a Simulator, until the launcher records that its cleanup finished.
 */
export async function waitForWarmSimulatorCleanupAsync(
  env: NodeJS.ProcessEnv,
  {
    timeoutMs = 150_000,
    pollMs = 250,
    signal,
  }: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {}
): Promise<void> {
  if (process.platform !== 'darwin' || env.EAS_USE_WARM_SIMULATOR === '1') {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    let state: { status?: unknown; error?: unknown };
    try {
      state = JSON.parse(await fs.readFile(LAUNCHER_STATE_FILE, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !existsSync(STARTUP_SCRIPT)) {
        return;
      }
      // Warmup may still be loading; only disabled confirms cleanup on an enabled VM.
      state = {};
    }
    if (state.status === 'disabled') {
      return;
    }
    if (Date.now() >= deadline) {
      throw new SystemError(
        `Warm Simulator cleanup did not finish${typeof state.error === 'string' ? ` (${state.error})` : ''}; the Simulator cannot be used.`
      );
    }
    // The signal is checked at each poll, so a cancelled job stops within one interval.
    await sleepAsync(pollMs);
  }
}
