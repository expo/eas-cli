import { Env, SystemError } from '@expo/eas-build-job';
import downloadFile from '@expo/downloader';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { isChildProcessAlive } from './processes';
import { sleepAsync } from './retry';
import { BuildContext } from '../context';

// Keep \t/\n; strip the rest (incl. \r / ESC) so ANSI cannot spoof build logs.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** GCS objects under turtle-v2/upterm — only the arches EAS workers use. */
export function resolveUptermGcsObjectName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string {
  if (platform === 'darwin' && arch === 'arm64') {
    return 'upterm-darwin-arm64';
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'upterm-linux-amd64';
  }
  throw new SystemError(
    `SSH upterm is only available on darwin/arm64 and linux/x64 (got ${platform}/${arch}).`
  );
}

const UPTERM_GCS_BASE_URL = 'https://storage.googleapis.com/turtle-v2/upterm';
const UPTERM_DOWNLOAD_TIMEOUT_MS = 60_000;
const UPTERM_KEEPALIVE_SLEEP_SECONDS = 6 * 60 * 60; // 6 hours
const CONNECTION_POLL_INTERVAL_MS = 500;
const CONNECTION_STARTUP_TIMEOUT_MS = 60_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const DEFAULT_SSH_PORT = '22';

export type SshConnectionConfig = {
  type: 'upterm-v1';
  host: string;
  secret: string;
};

export type UptermHost = {
  connectionConfig: SshConnectionConfig;
  getConnectedClientCountAsync: () => Promise<number | null>;
  isAlive: () => boolean;
  redialAsync: () => Promise<SshConnectionConfig>;
  stopAsync: () => Promise<void>;
};

const UptermSessionJsonZ = z.object({
  sessionId: z.string().min(1),
  host: z.string().min(1),
  clientCount: z.number().optional(),
});
type UptermSessionJson = z.infer<typeof UptermSessionJsonZ>;

/**
 * Parse `upterm session current --output json`.
 * `host` may be `ssh://hostname:22` or a bare hostname; `sessionId` is the join secret.
 */
export function parseUptermSessionJson(raw: string): SshConnectionConfig | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = UptermSessionJsonZ.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  return connectionConfigFromUptermSession(parsed.data);
}

function connectionConfigFromUptermSession(parsed: UptermSessionJson): SshConnectionConfig | null {
  let host = parsed.host;
  if (host.includes('://')) {
    let url: URL;
    try {
      url = new URL(host);
    } catch {
      return null;
    }
    // A non-default port has to survive: the CLI passes it to `ssh -p`.
    host = url.port && url.port !== DEFAULT_SSH_PORT ? `${url.hostname}:${url.port}` : url.hostname;
  }
  if (!host) {
    return null;
  }
  return { type: 'upterm-v1', host, secret: parsed.sessionId };
}

export function redactConnectionSecrets(text: string): string {
  let redacted = text.replace(CONTROL_CHARACTERS, '');
  // Every session token upterm emitted (userinfo before `@`), so each exact token can be scrubbed.
  for (const [, token] of redacted.matchAll(/upterm proxy wss?:\/\/([^@\s]+)@/g)) {
    redacted = redacted.split(token).join('<redacted>');
  }
  // Catch-all: redact URL userinfo (scheme://<userinfo>@) for any other credential in the text.
  return redacted.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1<redacted>@');
}

/** Spawn failures attach stdout/stderr; scrub secrets before logging the error object. */
export function redactSpawnErrorForLog(err: unknown): unknown {
  if (!err || typeof err !== 'object') {
    return err;
  }
  const spawnErr = err as { message?: unknown; stdout?: unknown; stderr?: unknown };
  return {
    ...spawnErr,
    ...(typeof spawnErr.message === 'string'
      ? { message: redactConnectionSecrets(spawnErr.message) }
      : {}),
    ...(typeof spawnErr.stdout === 'string'
      ? { stdout: redactConnectionSecrets(spawnErr.stdout) }
      : {}),
    ...(typeof spawnErr.stderr === 'string'
      ? { stderr: redactConnectionSecrets(spawnErr.stderr) }
      : {}),
  };
}

function killUptermProcessGroup(child: { pid?: number; kill: () => void } | undefined): void {
  if (child?.pid == null) {
    return;
  }
  try {
    // Negated pid = process group. We spawn detached, so bash/sleep children share the group;
    // killing only the upterm pid can leave them behind across redial.
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}

async function tryUptermOnPathAsync(env: Env): Promise<string | null> {
  try {
    // Use the job env (same PATH the host spawn gets), not process.env.
    await spawn('upterm', ['version'], { stdio: 'pipe', env });
    return 'upterm';
  } catch {
    return null;
  }
}

/**
 * Prefer an image/PATH install (Linux workers already bake upterm). Otherwise download the
 * platform binary from gs://turtle-v2/upterm (same pattern as xclogparser).
 */
export async function resolveUptermPathAsync(env: Env): Promise<string> {
  const onPath = await tryUptermOnPathAsync(env);
  if (onPath) {
    return onPath;
  }

  const objectName = resolveUptermGcsObjectName();
  const cacheDir = path.join(os.tmpdir(), 'eas-upterm');
  const cachePath = path.join(cacheDir, objectName);
  try {
    await fs.access(cachePath);
    return cachePath;
  } catch {
    // download below
  }

  await fs.mkdir(cacheDir, { recursive: true });
  const url = `${UPTERM_GCS_BASE_URL}/${objectName}`;
  try {
    await downloadFile(url, cachePath, { retry: 3, timeout: UPTERM_DOWNLOAD_TIMEOUT_MS });
    await fs.chmod(cachePath, 0o755);
  } catch (err) {
    await fs.rm(cachePath, { force: true }).catch(() => {});
    throw new SystemError(
      `The upterm SSH client was not on PATH and could not be downloaded from ${url}. ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return cachePath;
}

async function findAdminSocketPathAsync(uptermSocketDir: string): Promise<string | null> {
  const entries = await fs.readdir(uptermSocketDir).catch(() => [] as string[]);
  const socketName = entries.find(entry => entry.endsWith('.sock'));
  return socketName ? path.join(uptermSocketDir, socketName) : null;
}

async function readCurrentSessionJsonAsync(
  uptermPath: string,
  adminSocketPath: string
): Promise<UptermSessionJson | null> {
  try {
    // Pin --admin-socket to this host's temp runtime dir so we never read another session's
    // default socket (or a stale one left from a previous dial).
    const result = await spawn(
      uptermPath,
      ['session', 'current', '--admin-socket', adminSocketPath, '--output', 'json'],
      { stdio: 'pipe' }
    );
    const parsed = UptermSessionJsonZ.safeParse(JSON.parse(result.stdout));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function waitForConnectionConfigAsync(
  uptermPath: string,
  uptermSocketDir: string,
  getHostOutput: () => string
): Promise<SshConnectionConfig> {
  const deadline = Date.now() + CONNECTION_STARTUP_TIMEOUT_MS;
  for (;;) {
    const adminSocketPath = await findAdminSocketPathAsync(uptermSocketDir);
    if (adminSocketPath) {
      const session = await readCurrentSessionJsonAsync(uptermPath, adminSocketPath);
      if (session) {
        const connectionConfig = connectionConfigFromUptermSession(session);
        if (connectionConfig) {
          return connectionConfig;
        }
      }
    }
    if (Date.now() >= deadline) {
      throw new SystemError(
        `The upterm client did not register with the relay within ${
          CONNECTION_STARTUP_TIMEOUT_MS / 1_000
        }s. Output:\n${redactConnectionSecrets(getHostOutput())}`
      );
    }
    await sleepAsync(CONNECTION_POLL_INTERVAL_MS);
  }
}

async function getConnectedClientCountAsync(
  uptermPath: string,
  uptermSocketDir: string
): Promise<number | null> {
  const adminSocketPath = await findAdminSocketPathAsync(uptermSocketDir);
  if (!adminSocketPath) {
    // Missing socket is unknown, not proof of zero clients — a brief gap during
    // redial must not look like "idle" to the post-job teardown path.
    return null;
  }
  const session = await readCurrentSessionJsonAsync(uptermPath, adminSocketPath);
  if (!session || typeof session.clientCount !== 'number') {
    return null;
  }
  return session.clientCount;
}

export async function startUptermHostAsync(
  ctx: BuildContext,
  { relayServerUrl }: { relayServerUrl: string }
): Promise<UptermHost> {
  const uptermPath = await resolveUptermPathAsync(ctx.env);

  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-ssh-'));
  const hostKeyPath = path.join(stateDir, 'id_host');
  const forceCommandPath = path.join(stateDir, 'join.sh');
  const uptermSocketDir = path.join(stateDir, 'upterm');

  await spawn('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', hostKeyPath, '-q'], {
    logger: ctx.logger,
  });
  // upterm `--force-command` takes an executable path (not an inline string). Joining SSH
  // clients run this login shell; the host keep-alive `sleep` after `--` is separate.
  await fs.writeFile(forceCommandPath, '#!/usr/bin/env bash\nexec bash -l\n', { mode: 0o755 });

  let currentProcess: SpawnPromise<SpawnResult> | null = null;

  /**
   * Stops the running host process and waits for it to exit, so a redial cannot read the dying
   * session's admin socket and hand back a stale host and secret.
   */
  const stopCurrentProcessAsync = async (): Promise<void> => {
    const previousProcess = currentProcess;
    currentProcess = null;
    if (!previousProcess) {
      return;
    }
    killUptermProcessGroup(previousProcess.child);
    await Promise.race([
      previousProcess.catch(() => {}),
      sleepAsync(PROCESS_EXIT_TIMEOUT_MS).then(() => {
        ctx.logger.debug('The previous upterm host process did not exit in time.');
      }),
    ]);
  };

  const dialAsync = async (): Promise<SshConnectionConfig> => {
    await stopCurrentProcessAsync();
    await fs.rm(uptermSocketDir, { recursive: true, force: true }).catch(err => {
      ctx.logger.debug({ err }, 'Failed to clear the previous SSH socket directory.');
    });

    ctx.logger.debug('Connecting to the SSH relay.');
    // Two different "commands":
    // - `--force-command join.sh`: what each *SSH client* gets when they connect (interactive shell).
    // - `bash -lc sleep …` after `--`: the *host-side* process that keeps `upterm host` alive
    //   for hours even when nobody is connected (so idle wait / late joins still work).
    const uptermProcess = spawn(
      uptermPath,
      [
        'host',
        '--server',
        relayServerUrl,
        '--accept',
        '--skip-host-key-check',
        '-i',
        hostKeyPath,
        '--force-command',
        forceCommandPath,
        '--',
        'bash',
        '-lc',
        `sleep ${UPTERM_KEEPALIVE_SLEEP_SECONDS}`,
      ],
      {
        env: { ...ctx.env, XDG_RUNTIME_DIR: stateDir },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      }
    );
    uptermProcess.catch(err =>
      ctx.logger.debug({ err: redactSpawnErrorForLog(err) }, 'The upterm host process exited.')
    );
    uptermProcess.child.unref();
    currentProcess = uptermProcess;

    let output = '';
    const appendChunk = (chunk: Buffer | string): void => {
      output += chunk.toString();
    };
    uptermProcess.child.stdout?.on('data', appendChunk);
    uptermProcess.child.stderr?.on('data', appendChunk);

    return await waitForConnectionConfigAsync(uptermPath, uptermSocketDir, () => output);
  };

  const stopAsync = async (): Promise<void> => {
    await stopCurrentProcessAsync();
    await fs.rm(stateDir, { recursive: true, force: true });
  };

  let connectionConfig: SshConnectionConfig;
  try {
    connectionConfig = await dialAsync();
  } catch (err) {
    await stopAsync();
    throw err;
  }

  return {
    get connectionConfig() {
      return connectionConfig;
    },
    getConnectedClientCountAsync: () => getConnectedClientCountAsync(uptermPath, uptermSocketDir),
    isAlive: () => isChildProcessAlive(currentProcess?.child),
    redialAsync: async () => {
      connectionConfig = await dialAsync();
      return connectionConfig;
    },
    stopAsync,
  };
}
