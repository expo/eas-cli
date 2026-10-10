import { SystemError, UserError } from '@expo/eas-build-job';
import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs, { constants } from 'node:fs';
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

export async function runServeSimActionAsync({
  port,
  token,
  action,
  params,
  timeoutMs,
  signal,
}: {
  port: number;
  token: string;
  action: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/exec-ws`, [`serve-sim.token.${token}`]);
    let settled = false;
    let sent = false;
    const finish = (error?: unknown) => {
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
        resolve();
      }
    };
    const aborted = () => finish(signal?.reason ?? new Error('Serve-sim action aborted.'));
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
            : new SystemError(
                `serve-sim ${action} failed: ${(typeof reply.error === 'string' && reply.error) || (typeof reply.stderr === 'string' && reply.stderr) || 'invalid response'}`
              )
        );
      }
    });
    if (signal?.aborted) {
      aborted();
    }
  });
}

export async function readIosApplicationIdentifierAsync({
  artifactPath,
  env,
}: {
  artifactPath: string;
  env: BuildStepEnv;
}): Promise<string> {
  const artifactStat = await fs.promises.stat(artifactPath).catch(err => {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      `Build artifact does not exist at ${artifactPath}.`,
      { cause: err }
    );
  });
  if (path.extname(artifactPath) !== '.app' || !artifactStat.isDirectory()) {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      'iOS Simulator sessions require a .app build artifact.'
    );
  }
  const infoPlistPath = path.join(artifactPath, 'Info.plist');
  const { stdout } = await spawn(
    'plutil',
    ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlistPath],
    { stdio: 'pipe', env }
  );
  const applicationIdentifier = stdout.trim();
  if (!applicationIdentifier) {
    throw new UserError(
      'EAS_INSTALL_BUILD_MISSING_IDENTIFIER',
      `Could not read CFBundleIdentifier from ${infoPlistPath}.`
    );
  }
  return applicationIdentifier;
}
