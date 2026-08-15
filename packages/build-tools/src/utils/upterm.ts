import { Env, SystemError } from '@expo/eas-build-job';
import downloadFile from '@expo/downloader';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { isChildProcessAlive, killProcessGroup } from './processes';
import { sleepAsync } from './retry';
import { BuildContext } from '../context';

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

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
const UPTERM_KEEPALIVE_SLEEP_SECONDS = 6 * 60 * 60;
const CONNECTION_POLL_INTERVAL_MS = 500;
const CONNECTION_STARTUP_TIMEOUT_MS = 60_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const CLIENT_COUNT_READ_ATTEMPTS = 4;
const CLIENT_COUNT_READ_RETRY_MS = 500;
const DEFAULT_SSH_PORT = '22';

export type SshConnectionConfig = {
  type: 'upterm-v1';
  host: string;
  secret: string;
};

export type UptermHost = {
  connectionConfig: SshConnectionConfig;
  getConnectedClientCountAsync: () => Promise<number>;
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

export function connectionConfigFromUptermSession(
  parsed: Pick<UptermSessionJson, 'sessionId' | 'host'>
): SshConnectionConfig | null {
  let host = parsed.host;
  if (host.includes('://')) {
    let url: URL;
    try {
      url = new URL(host);
    } catch {
      return null;
    }
    host = url.port && url.port !== DEFAULT_SSH_PORT ? `${url.hostname}:${url.port}` : url.hostname;
  }
  if (!host) {
    return null;
  }
  return { type: 'upterm-v1', host, secret: parsed.sessionId };
}

export function redactConnectionSecrets(text: string): string {
  let redacted = text.replace(CONTROL_CHARACTERS, '');
  for (const [, token] of redacted.matchAll(/upterm proxy wss?:\/\/([^@\s]+)@/g)) {
    redacted = redacted.split(token).join('<redacted>');
  }
  return redacted.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1<redacted>@');
}

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

export async function resolveUptermPathAsync(env: Env): Promise<string> {
  try {
    await spawn('upterm', ['version'], { stdio: 'pipe', env });
    return 'upterm';
  } catch {}

  const objectName = resolveUptermGcsObjectName();
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-upterm-'));
  const uptermPath = path.join(downloadDir, objectName);
  const url = `${UPTERM_GCS_BASE_URL}/${objectName}`;
  try {
    await downloadFile(url, uptermPath, { retry: 3, timeout: UPTERM_DOWNLOAD_TIMEOUT_MS });
    await fs.chmod(uptermPath, 0o755);
  } catch (err) {
    await fs.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
    throw new SystemError(
      `The upterm SSH client was not on PATH and could not be downloaded from ${url}. ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return uptermPath;
}

async function findAdminSocketPathAsync(uptermSocketDir: string): Promise<string | null> {
  // Use this dial's own admin socket, not upterm's default, which can still point at a previous
  // dial's session after a redial and break client-count reads.
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
  await fs.writeFile(forceCommandPath, '#!/usr/bin/env bash\nexec bash -l\n', { mode: 0o755 });

  let currentProcess: SpawnPromise<SpawnResult> | null = null;

  const stopCurrentProcessAsync = async (): Promise<void> => {
    const previousProcess = currentProcess;
    currentProcess = null;
    if (!previousProcess) {
      return;
    }
    killProcessGroup(previousProcess.child);
    await Promise.race([
      previousProcess.catch(() => {}),
      sleepAsync(PROCESS_EXIT_TIMEOUT_MS).then(() => {
        ctx.logger.debug('The previous upterm host process did not exit in time.');
      }),
    ]);
  };

  const getConnectedClientCountAsync = async (): Promise<number> => {
    for (let attempt = 1; attempt <= CLIENT_COUNT_READ_ATTEMPTS; attempt++) {
      const adminSocketPath = await findAdminSocketPathAsync(uptermSocketDir);
      const session = adminSocketPath
        ? await readCurrentSessionJsonAsync(uptermPath, adminSocketPath)
        : null;
      if (session && typeof session.clientCount === 'number') {
        return session.clientCount;
      }
      if (attempt < CLIENT_COUNT_READ_ATTEMPTS) {
        await sleepAsync(CLIENT_COUNT_READ_RETRY_MS);
      }
    }
    throw new SystemError('Could not read the SSH client count from the upterm admin socket.', {
      trackingCode: 'SSH_CLIENT_COUNT_UNREADABLE',
    });
  };

  const dialAsync = async (): Promise<SshConnectionConfig> => {
    await stopCurrentProcessAsync();
    await fs.rm(uptermSocketDir, { recursive: true, force: true }).catch(err => {
      ctx.logger.debug({ err }, 'Failed to clear the previous SSH socket directory.');
    });

    ctx.logger.debug('Connecting to the SSH relay.');
    // --force-command is what each connecting SSH client runs (a login shell). The `sleep` after
    // `--` is the host-side process that keeps `upterm host` up while nobody is connected.
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
        // upterm puts its admin socket under XDG_RUNTIME_DIR; point it at our state dir so we can
        // find it for `session current` and clean it up on stop/redial.
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
    getConnectedClientCountAsync,
    isAlive: () => currentProcess != null && isChildProcessAlive(currentProcess.child),
    redialAsync: async () => {
      connectionConfig = await dialAsync();
      return connectionConfig;
    },
    stopAsync,
  };
}
