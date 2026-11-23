import { SystemError, UserError } from '@expo/eas-build-job';
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

export async function runServeSimActionAsync(
  options: Parameters<typeof runServeSimActionWithResultAsync>[0]
): Promise<void> {
  await runServeSimActionWithResultAsync(options);
}

export async function runServeSimActionWithResultAsync({
  port,
  token,
  action,
  params,
  timeoutMs,
  signal,
  drainAfterDispatch = false,
}: {
  port: number;
  token: string;
  action: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Abort before dispatch; once sent, wait for its reply or deadline because exec-ws cannot cancel it. */
  drainAfterDispatch?: boolean;
}): Promise<string> {
  signal?.throwIfAborted();
  return await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/exec-ws`, [`serve-sim.token.${token}`]);
    let settled = false;
    let sent = false;
    const finish = (error?: unknown, stdout = '') => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      socket.terminate();
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    };
    const aborted = () => {
      if (!sent || !drainAfterDispatch) {
        finish(signal?.reason ?? new Error('Serve-sim action aborted.'));
      }
    };
    const timer = setTimeout(
      () => finish(new SystemError(`serve-sim ${action} timed out.`)),
      timeoutMs
    );
    signal?.addEventListener('abort', aborted, { once: true });
    socket.on('error', () => finish(new SystemError(`serve-sim ${action} connection failed.`)));
    socket.on('close', () =>
      finish(new SystemError(`serve-sim ${action} connection closed before completion.`))
    );
    socket.on('message', data => {
      if (settled) {
        return;
      }
      let reply;
      try {
        reply = JSON.parse(data.toString());
      } catch {
        return finish(new SystemError(`serve-sim ${action} returned invalid JSON.`));
      }
      if (reply?.ready === true && !sent) {
        sent = true;
        socket.send(JSON.stringify({ id: 1, action, params }));
      } else if (reply?.id === 1 && sent) {
        finish(
          reply.exitCode === 0
            ? undefined
            : createServeSimActionError(
                action,
                (typeof reply.error === 'string' && reply.error) ||
                  (typeof reply.stderr === 'string' && reply.stderr) ||
                  'invalid response'
              ),
          typeof reply.stdout === 'string' ? reply.stdout : ''
        );
      }
    });
    if (signal?.aborted) {
      aborted();
    }
  });
}

// simctl's IXUserPresentableErrorDomain message when the app's minimum iOS version is above the Simulator runtime.
const NEWER_IOS_REQUIRED_MESSAGE = 'Requires a Newer Version of iOS';

function createServeSimActionError(action: string, detail: string): Error {
  const message = `serve-sim ${action} failed: ${detail}`;
  if (action === 'app.install' && detail.includes(NEWER_IOS_REQUIRED_MESSAGE)) {
    return new UserError(
      'EAS_INSTALL_APPLICATION_REQUIRES_NEWER_IOS',
      "This app requires a newer iOS version than the selected iOS Simulator runs. Choose an iOS Simulator device whose iOS version meets the app's minimum iOS version, or lower the app's iOS deployment target.",
      { cause: new Error(message) }
    );
  }
  return new SystemError(message);
}
