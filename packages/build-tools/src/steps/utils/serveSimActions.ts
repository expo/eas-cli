import { SystemError } from '@expo/eas-build-job';
import { constants } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

export async function stageServeSimAppAsync(
  appPath: string,
  tmpdir = os.tmpdir()
): Promise<{
  directory: string;
  path: string;
}> {
  // Clone into app.install's approved root while preserving the caller's app.
  const root = path.join(tmpdir, 'serve-sim-uploads');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(root, 'eas-app-'));
  const stagedPath = path.join(directory, path.basename(appPath));
  try {
    await cp(await realpath(appPath), stagedPath, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      verbatimSymlinks: true,
    });
    return { directory, path: stagedPath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

type ServeSimRequest = {
  port: number;
  token: string;
  action: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Abort before dispatch; once sent, wait for its reply or deadline because exec-ws cannot cancel it. */
  drainAfterDispatch?: boolean;
};

/** What a reply frame means for the request: keep waiting, or finish with a result or an error. */
type ServeSimReplyOutcome<T> = { result: T } | { error: Error } | undefined;

export async function runServeSimActionAsync(options: ServeSimRequest): Promise<void> {
  await runServeSimActionWithResultAsync(options);
}

export type ServeSimActionResult = { stdout: string };

export async function runServeSimActionWithResultAsync(
  options: ServeSimRequest
): Promise<ServeSimActionResult> {
  return await runServeSimRequestAsync(options, data => {
    const reply = parseReply(options.action, data);
    if ('error' in reply) {
      return reply;
    }
    if (reply.json?.id !== 1) {
      return undefined;
    }
    if (reply.json.exitCode !== 0) {
      return { error: replyError(options.action, reply.json) };
    }
    return { result: { stdout: typeof reply.json.stdout === 'string' ? reply.json.stdout : '' } };
  });
}

export type ServeSimScreenshot = {
  image: Buffer;
  /** Untrusted; serve-sim sends it in a JSON frame after the image. */
  metadata?: unknown;
};

/**
 * Captures a screenshot as exec-ws binary output, so the caller gets the image bytes, not a path.
 * Set `waitForMetadata` only when the catalog advertises `binaryMetadataFrame`; older servers
 * send the image alone.
 */
export async function captureServeSimScreenshotAsync({
  params,
  waitForMetadata,
  ...options
}: Omit<ServeSimRequest, 'action' | 'drainAfterDispatch'> & {
  waitForMetadata: boolean;
}): Promise<ServeSimScreenshot> {
  const action = 'screenshot.capture';
  let image: Buffer | undefined;
  return await runServeSimRequestAsync(
    {
      ...options,
      action,
      params: { ...params, output: 'binary' },
      // A sent capture still runs on the host, so its reply is drained before honoring abort.
      drainAfterDispatch: true,
    },
    (data, isBinary): ServeSimReplyOutcome<ServeSimScreenshot> => {
      if (isBinary) {
        // A binary reply is the uint32 big-endian request id followed by the PNG bytes.
        if (image || data.length < 4 || data.readUInt32BE(0) !== 1) {
          return {
            error: new SystemError(`serve-sim ${action} returned a malformed image frame.`),
          };
        }
        image = data.subarray(4);
        if (image.length === 0) {
          return { error: new SystemError(`serve-sim ${action} returned an empty image.`) };
        }
        return waitForMetadata ? undefined : { result: { image } };
      }
      const reply = parseReply(action, data);
      if ('error' in reply) {
        return reply;
      }
      if (reply.json?.id !== 1) {
        return undefined;
      }
      if (image && reply.json.error === undefined && 'screenshotMetadata' in reply.json) {
        return { result: { image, metadata: reply.json.screenshotMetadata } };
      }
      return { error: replyError(action, reply.json) };
    }
  );
}

type ServeSimReply = Record<string, unknown>;

function parseReply(
  action: string,
  data: Buffer
): { json: ServeSimReply | null } | { error: Error } {
  try {
    const json: unknown = JSON.parse(data.toString());
    return { json: json !== null && typeof json === 'object' ? (json as ServeSimReply) : null };
  } catch {
    return { error: new SystemError(`serve-sim ${action} returned invalid JSON.`) };
  }
}

function replyError(action: string, reply: ServeSimReply): SystemError {
  return new SystemError(
    `serve-sim ${action} failed: ${(typeof reply.error === 'string' && reply.error) || (typeof reply.stderr === 'string' && reply.stderr) || 'invalid response'}`
  );
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}

async function runServeSimRequestAsync<T>(
  { port, token, action, params, timeoutMs, signal, drainAfterDispatch = false }: ServeSimRequest,
  /** Called for each frame after the request was sent. */
  handleReply: (data: Buffer, isBinary: boolean) => ServeSimReplyOutcome<T>
): Promise<T> {
  signal?.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/exec-ws`, [`serve-sim.token.${token}`]);
    let settled = false;
    let sent = false;
    const finish = (outcome: { result: T } | { error: unknown }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      socket.terminate();
      if ('error' in outcome) {
        reject(outcome.error);
      } else {
        resolve(outcome.result);
      }
    };
    const aborted = () => {
      if (!sent || !drainAfterDispatch) {
        finish({ error: signal?.reason ?? new Error('Serve-sim action aborted.') });
      }
    };
    const timer = setTimeout(
      () => finish({ error: new SystemError(`serve-sim ${action} timed out.`) }),
      timeoutMs
    );
    signal?.addEventListener('abort', aborted, { once: true });
    socket.on('error', () =>
      finish({ error: new SystemError(`serve-sim ${action} connection failed.`) })
    );
    socket.on('close', () =>
      finish({ error: new SystemError(`serve-sim ${action} connection closed before completion.`) })
    );
    socket.on('message', (raw, isBinary) => {
      if (settled) {
        return;
      }
      const data = toBuffer(raw);
      if (sent) {
        const outcome = handleReply(data, isBinary);
        if (outcome) {
          finish(outcome);
        }
        return;
      }
      const reply = parseReply(action, data);
      if ('error' in reply) {
        finish(reply);
      } else if (reply.json?.ready === true) {
        sent = true;
        socket.send(JSON.stringify({ id: 1, action, params }));
      }
    });
    if (signal?.aborted) {
      aborted();
    }
  });
}
