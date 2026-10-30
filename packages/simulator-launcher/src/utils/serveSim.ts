import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

import { type ChildProcessHandle, commands, isProcessOwnedByServiceAsync } from './processes';
import { type WarmServer } from './state';

const SERVE_SIM_READY_TIMEOUT_MS = 120_000;
// The job needs the token from this file; /readyz itself is not token-gated.
const ServeSimStateSchema = z.object({
  pid: z.number().int().min(2),
  port: z.number().int().min(1).max(65535),
  device: z.string(),
  url: z.string(),
  token: z.string().min(1),
});

export function startServeSim(
  devices: string[],
  signal: AbortSignal,
  port = 3200
): ChildProcessHandle {
  signal.throwIfAborted();
  return commands.start(
    'bunx',
    [
      `@expo/serve-sim@${process.env.SERVE_SIM_VERSION || 'latest'}`,
      ...devices,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--require-token',
      '--orphan',
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
    // The orphan owns boot, device selection and its native children for this VM's job.
    { detached: true }
  );
}

/** A job reads serve-sim's state and calls /readyz as soon as its claim returns. */
export async function waitForServeSimReadyAsync(
  udid: string,
  server: ChildProcessHandle,
  signal: AbortSignal,
  port = 3200
): Promise<WarmServer> {
  const url = `http://127.0.0.1:${port}`;
  let exited = false;
  // Handle both outcomes: a rejection here would otherwise be unhandled and end the launcher.
  const markExited = (): void => {
    exited = true;
  };
  void server.resultPromise.then(markExited, markExited);
  const throwIfExited = (): void => {
    if (exited || server.child.exitCode != null || server.child.signalCode != null) {
      throw new Error(`serve-sim exited before ${udid} became ready.`);
    }
  };
  const stateDirectory = process.env.SERVE_SIM_STATE_DIR || path.join(os.tmpdir(), 'serve-sim');
  const stateFile = path.join(stateDirectory, `server-${udid}.json`);
  const deadline = Date.now() + SERVE_SIM_READY_TIMEOUT_MS;
  for (;;) {
    signal.throwIfAborted();
    throwIfExited();
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for serve-sim on ${udid} to become ready.`);
    }
    const state = await fs
      .readFile(stateFile, 'utf8')
      .then(contents => ServeSimStateSchema.parse(JSON.parse(contents)))
      .catch(() => undefined);
    // Only the local serve-sim this launcher started may be probed; the job checks the same.
    if (state && state.url !== url) {
      throw new Error(`serve-sim on ${udid} reports ${state.url}, not ${url}.`);
    }
    if (state && (state.port !== port || state.device.toUpperCase() !== udid.toUpperCase())) {
      throw new Error('The warm serve-sim registration reports a different device or port.');
    }
    let readyForDevice = false;
    if (state && (await isProcessOwnedByServiceAsync(state.pid, server.child, signal))) {
      try {
        const response = await fetch(`${url}/readyz`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
        });
        const ready = response.ok
          ? ((await response.json()) as { status?: string; device?: string })
          : {};
        readyForDevice =
          ready.status === 'ready' && ready.device?.toUpperCase() === udid.toUpperCase();
      } catch {
        // serve-sim writes its state and answers /readyz only once it is listening.
      }
    }
    signal.throwIfAborted();
    throwIfExited();
    if (
      readyForDevice &&
      state &&
      (await isProcessOwnedByServiceAsync(state.pid, server.child, signal))
    ) {
      signal.throwIfAborted();
      throwIfExited();
      const nativeStartTime = (
        await commands.runAsync('ps', ['-p', String(state.pid), '-o', 'lstart='], signal)
      ).trim();
      signal.throwIfAborted();
      throwIfExited();
      if (
        !nativeStartTime ||
        !(await isProcessOwnedByServiceAsync(state.pid, server.child, signal))
      ) {
        throw new Error('The warm serve-sim process identity could not be confirmed.');
      }
      return {
        startupDevice: udid,
        pid: state.pid,
        nativeStartTime,
        port,
        url,
        token: state.token,
      };
    }
    await sleepAsync(250, undefined, { signal });
  }
}
