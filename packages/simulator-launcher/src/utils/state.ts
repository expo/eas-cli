import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

export const LAUNCHER_STATE_FILE = '/tmp/expo-simulator-startup.json';

const NonBlankStringSchema = z.string().regex(/\S/, 'Must not be blank.');
export const SimulatorDeviceSchema = z.object({
  udid: NonBlankStringSchema,
  name: NonBlankStringSchema,
});
export const ClaimInputSchema = z.object({
  engine: z.enum(['serve-sim', 'agent-device', 'argent']),
  requestedDevice: NonBlankStringSchema.optional(),
});
export const WarmSessionInfoSchema = z.object({
  device: SimulatorDeviceSchema,
  controllerPid: z.number().int().gt(1),
  controllerStartTime: NonBlankStringSchema,
  agentDeviceStateDir: NonBlankStringSchema,
  argentEventLogPath: NonBlankStringSchema,
});
export const LauncherStateSchema = WarmSessionInfoSchema.partial().extend({
  bootUuid: NonBlankStringSchema,
  status: z.enum(['starting', 'ready', 'claiming', 'claimed', 'stopping', 'disabled']),
  ...ClaimInputSchema.partial().shape,
  error: z.string().optional(),
});
export type LauncherState = z.infer<typeof LauncherStateSchema>;
export type WarmSessionInfo = z.infer<typeof WarmSessionInfoSchema>;
export type SimulatorDevice = z.infer<typeof SimulatorDeviceSchema>;

export function getInstalledLauncherDirectory(): string {
  return path.join(os.homedir(), '.expo/simulator-tools');
}

export async function readLauncherStateAsync(bootUuid: string): Promise<LauncherState | undefined> {
  let contents: string;
  try {
    contents = await fs.readFile(LAUNCHER_STATE_FILE, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  const state = LauncherStateSchema.parse(JSON.parse(contents));
  return state.bootUuid === bootUuid ? state : undefined;
}

/** Serialize only state I/O. The callback is synchronous; native work belongs outside this lock. */
export async function updateLauncherStateAsync(
  bootUuid: string,
  update: (state: LauncherState | undefined) => LauncherState,
  signal?: AbortSignal
): Promise<LauncherState> {
  const lock = `${LAUNCHER_STATE_FILE}.${bootUuid}.lock`;
  const deadline = Date.now() + 5_000;
  for (;;) {
    signal?.throwIfAborted();
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          'Simulator state is locked by another command; cleanup cannot be confirmed.'
        );
      }
      await sleepAsync(50, undefined, { signal });
    }
  }
  const temporaryPath = `${LAUNCHER_STATE_FILE}.${randomUUID()}.tmp`;
  try {
    const state = LauncherStateSchema.parse(update(await readLauncherStateAsync(bootUuid)));
    if (state.bootUuid !== bootUuid) {
      throw new Error('Simulator state belongs to a different VM boot.');
    }
    await fs.writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { flag: 'wx' });
    signal?.throwIfAborted();
    await fs.rename(temporaryPath, LAUNCHER_STATE_FILE);
    return state;
  } finally {
    try {
      await fs.rm(temporaryPath, { force: true });
    } finally {
      await fs.rmdir(lock);
    }
  }
}

export async function waitForLauncherStateAsync(
  bootUuid: string,
  isComplete: (state: LauncherState | undefined) => boolean,
  timeoutMs: number
): Promise<LauncherState | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await readLauncherStateAsync(bootUuid);
    if (isComplete(state)) {
      return state;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'Timed out waiting for the Simulator launcher; cleanup may still be running.'
      );
    }
    await sleepAsync(100);
  }
}
