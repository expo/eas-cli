import { SystemError } from '@expo/eas-build-job';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { isChildProcessAlive } from './processes';
import { sleepAsync } from './retry';
import { BuildContext } from '../context';

export function resolveUptermArch(arch: string): 'amd64' | 'arm64' {
  return arch === 'arm64' ? 'arm64' : 'amd64';
}

const UPTERM_BIN_PATH = path.join(
  __dirname,
  '..',
  '..',
  'bin',
  `upterm-${resolveUptermArch(process.arch)}`
);
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
  sessionId: z.string().optional(),
  host: z.string().optional(),
  clientCount: z.number().optional(),
});
type UptermSessionJson = z.infer<typeof UptermSessionJsonZ>;

/**
 * Parse `upterm session current --output json`.
 * `host` may be `ssh://hostname:22` or a bare hostname; `sessionId` is the join secret.
 */
export function parseUptermSessionJson(raw: string): SshConnectionConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = UptermSessionJsonZ.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  return connectionConfigFromUptermSession(result.data);
}

function connectionConfigFromUptermSession(parsed: UptermSessionJson): SshConnectionConfig | null {
  if (!parsed.sessionId || !parsed.host) {
    return null;
  }
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
  let redacted = text;
  // Every session token upterm emitted (userinfo before `@`), so each exact token can be scrubbed.
  for (const [, token] of text.matchAll(/upterm proxy wss:\/\/([^@\s]+)@/g)) {
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
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}

async function resolveUptermPathAsync(): Promise<string> {
  try {
    await fs.access(UPTERM_BIN_PATH);
  } catch {
    throw new SystemError(
      `The upterm SSH client was not found at ${UPTERM_BIN_PATH}. It is baked into the worker package at build time, so this worker image is likely missing it.`
    );
  }
  return UPTERM_BIN_PATH;
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
  const uptermPath = await resolveUptermPathAsync();

  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-ssh-'));
  const hostKeyPath = path.join(stateDir, 'id_host');
  const forceCommandPath = path.join(stateDir, 'join.sh');
  const uptermSocketDir = path.join(stateDir, 'upterm');

  await spawn('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', hostKeyPath, '-q'], {
    logger: ctx.logger,
  });
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
