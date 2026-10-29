import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

export const LAUNCHER_STATE_FILE = '/tmp/expo-simulator-startup.json';

const NonBlankStringSchema = z.string().regex(/\S/, 'Must not be blank.');
export const SimulatorDeviceSchema = z.object({
  udid: NonBlankStringSchema,
  name: NonBlankStringSchema,
});
export const WarmServerSchema = z.object({
  startupDevice: NonBlankStringSchema,
  pid: z.number().int().gt(1),
  nativeStartTime: NonBlankStringSchema,
  port: z.number().int().min(1).max(65535),
  url: z.string().url(),
  token: NonBlankStringSchema,
});
const ToolServerSchema = WarmServerSchema.pick({ pid: true, port: true, token: true });
export const ClaimInputSchema = z.object({
  engine: z.enum(['serve-sim', 'agent-device', 'argent']),
  requestedDevice: NonBlankStringSchema.optional(),
});
/** The Expo Go this launcher installed on `udid` and never launched. */
export const PreinstalledAppSchema = z.object({
  udid: NonBlankStringSchema,
  bundleIdentifier: NonBlankStringSchema,
  shortVersion: z.string(),
  version: z.string(),
});
export const WarmSessionInfoSchema = z.object({
  // The default before claim, then the device selected for the job.
  device: SimulatorDeviceSchema,
  server: WarmServerSchema,
  controllerPid: z.number().int().gt(1),
  controllerStartTime: NonBlankStringSchema,
  agentDeviceStateDir: NonBlankStringSchema,
  argentEventLogPath: NonBlankStringSchema,
});
export const LauncherStateSchema = WarmSessionInfoSchema.partial().extend({
  bootUuid: NonBlankStringSchema,
  launcherVersion: NonBlankStringSchema.optional(),
  status: z.enum(['starting', 'ready', 'claiming', 'claimed', 'stopping', 'disabled']),
  ...ClaimInputSchema.partial().shape,
  preinstalledExpoGo: PreinstalledAppSchema.optional(),
  prepareToolsRequested: z.boolean().optional(),
  toolsReady: z.boolean().optional(),
  tools: ToolServerSchema.optional(),
  error: z.string().optional(),
});
export type ClaimInput = z.infer<typeof ClaimInputSchema>;
export type LauncherState = z.infer<typeof LauncherStateSchema>;
export type WarmSessionInfo = z.infer<typeof WarmSessionInfoSchema>;
export type WarmServer = z.infer<typeof WarmServerSchema>;
export type ToolServer = z.infer<typeof ToolServerSchema>;
export type SimulatorDevice = z.infer<typeof SimulatorDeviceSchema>;
export type PreinstalledApp = z.infer<typeof PreinstalledAppSchema>;

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
    // The claimed server credentials belong to this OS user, like serve-sim's own registry.
    await fs.writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 });
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
