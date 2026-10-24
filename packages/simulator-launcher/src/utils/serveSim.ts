import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

import { type ChildProcessHandle, commands } from './processes';

const SERVE_SIM_READY_TIMEOUT_MS = 120_000;
const ServeSimStateSchema = z.object({ device: z.string(), url: z.string(), token: z.string() });

export function startServeSim(udid: string, signal: AbortSignal): ChildProcessHandle {
  signal.throwIfAborted();
  return commands.start('bunx', [
    `@expo/serve-sim@${process.env.SERVE_SIM_VERSION || 'latest'}`,
    udid,
    '--host',
    '127.0.0.1',
    '--port',
    '3200',
    '--require-token',
    '--transport',
    'webrtc',
    '--webrtc-codec',
    'h264',
    '--max-dimension',
    '1600',
    '--mjpeg-quality',
    '0.55',
    '--video-bitrate',
    '10000000',
    '--video-fps',
    '60',
    '--disable-share',
    '--quiet',
  ]);
}

/** A job reads serve-sim's state and calls /readyz as soon as its claim returns. */
export async function waitForServeSimReadyAsync(
  udid: string,
  server: ChildProcessHandle,
  signal: AbortSignal
): Promise<void> {
  let exited = false;
  void server.resultPromise.finally(() => {
    exited = true;
  });
  const stateFile = path.join(os.tmpdir(), 'serve-sim', `server-${udid}.json`);
  const deadline = Date.now() + SERVE_SIM_READY_TIMEOUT_MS;
  for (;;) {
    signal.throwIfAborted();
    if (exited) {
      throw new Error(`serve-sim exited before ${udid} became ready.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for serve-sim on ${udid} to become ready.`);
    }
    try {
      const state = ServeSimStateSchema.parse(JSON.parse(await fs.readFile(stateFile, 'utf8')));
      const response = await fetch(`${state.url}/readyz`, {
        headers: { Authorization: `Bearer ${state.token}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
      });
      const ready = response.ok
        ? ((await response.json()) as { status?: string; device?: string })
        : {};
      if (ready.status === 'ready' && ready.device?.toUpperCase() === udid.toUpperCase()) {
        return;
      }
    } catch {
      // serve-sim writes its state and answers /readyz only once it is listening.
    }
    await sleepAsync(250, undefined, { signal });
  }
}
