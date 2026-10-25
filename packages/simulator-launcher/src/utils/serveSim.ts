import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

import { type ChildProcessHandle, commands } from './processes';

const SERVE_SIM_PORT = 3200;
const SERVE_SIM_READY_TIMEOUT_MS = 120_000;
// The job needs the token from this file; /readyz itself is not token-gated.
const ServeSimStateSchema = z.object({ device: z.string(), url: z.string(), token: z.string() });

export function startServeSim(udid: string, signal: AbortSignal): ChildProcessHandle {
  signal.throwIfAborted();
  return commands.start(
    'bunx',
    [
      `@expo/serve-sim@${process.env.SERVE_SIM_VERSION || 'latest'}`,
      udid,
      '--host',
      '127.0.0.1',
      '--port',
      String(SERVE_SIM_PORT),
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
    ],
    undefined,
    /* captureStdout */ false,
    // Its own group lets replacement stop serve-sim and the children it respawns together.
    /* detached */ true
  );
}

/** A job reads serve-sim's state and calls /readyz as soon as its claim returns. */
export async function waitForServeSimReadyAsync(
  udid: string,
  server: ChildProcessHandle,
  signal: AbortSignal
): Promise<void> {
  let exited = false;
  // Handle both outcomes: a rejection here would otherwise be unhandled and end the launcher.
  const markExited = (): void => {
    exited = true;
  };
  void server.resultPromise.then(markExited, markExited);
  const stateDirectory = process.env.SERVE_SIM_STATE_DIR || path.join(os.tmpdir(), 'serve-sim');
  const stateFile = path.join(stateDirectory, `server-${udid}.json`);
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

/** A replacement serve-sim can bind its port once nothing accepts connections on it. */
export async function waitForServeSimPortFreeAsync(
  signal: AbortSignal,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal.throwIfAborted();
    const listening = await new Promise<boolean>(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port: SERVE_SIM_PORT });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (!listening) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Port ${SERVE_SIM_PORT} is still in use; the previous serve-sim did not stop.`
      );
    }
    await sleepAsync(100, undefined, { signal });
  }
}
