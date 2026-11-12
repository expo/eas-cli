import { Env, SystemError } from '@expo/eas-build-job';
import downloadFile from '@expo/downloader';
import { bunyan } from '@expo/logger';
import spawn, { SpawnResult } from '@expo/turtle-spawn';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { getProxiedDownloadUrl } from './download';
import { isProcessRunning } from './processes';
import { sleepAsync } from './retry';
import { BuildContext } from '../context';

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const BLOCKED_TUNNEL_REASONS = new Set([
  'agent_refused',
  'auth_refused',
  'proof_refused',
  'relay_key_changed',
  'relay_unsupported',
]);
const SESSION_ID_JSON_FIELD = /"sessionId"\s*:\s*"([^"]+)"/g;

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
const CONNECTION_STARTUP_TIMEOUT_MS = 60_000;
const CLIENT_COUNT_READ_ATTEMPTS = 4;
const CLIENT_COUNT_READ_RETRY_MS = 500;

export type SshConnectionConfig = {
  type: 'upterm-v1';
  secret: string;
};

export type UptermSessionStatus =
  | { state: 'ready' | 'reconnecting'; connectedClientCount: number }
  | { state: 'gone'; reason: string };

export type UptermHost = {
  connectionConfig: SshConnectionConfig;
  startedReconnecting: boolean;
  readStatusAsync: () => Promise<UptermSessionStatus>;
  stopAsync: () => Promise<void>;
};

const UptermStartedJsonZ = z.object({
  sessionId: z.string().min(1),
  adminSocket: z.string().min(1),
  pid: z.number().int().positive(),
  status: z.enum(['ready', 'reconnecting']),
});

const UptermCurrentSessionJsonZ = z.object({
  guestCount: z.number(),
  status: z.string(),
  tunnelReason: z.string().optional(),
});

/**
 * Strip upterm session secrets out of text before it reaches a log or an error message. The
 * session id is the secret: any id in a `sessionId` field of upterm's JSON output is removed
 * everywhere. Control characters are dropped first so they cannot split a token mid-match.
 */
export function redactConnectionSecrets(text: string): string {
  let redacted = text.replace(CONTROL_CHARACTERS, '');
  for (const [, id] of redacted.matchAll(SESSION_ID_JSON_FIELD)) {
    redacted = redacted.split(id).join('<redacted>');
  }
  return redacted;
}

export async function resolveUptermAsync(
  env: Env,
  logger: bunyan
): Promise<{ uptermPath: string; downloadDir: string }> {
  const objectName = resolveUptermGcsObjectName();
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-upterm-'));
  const uptermPath = path.join(downloadDir, objectName);
  const directUrl = `${UPTERM_GCS_BASE_URL}/${objectName}`;
  const proxiedUrl = getProxiedDownloadUrl({
    directUrl,
    proxyBaseUrl: env.EAS_BUILD_COCOAPODS_CACHE_URL,
  });

  const downloadAsync = async (url: string): Promise<void> => {
    await downloadFile(url, uptermPath, { retry: 3, timeout: UPTERM_DOWNLOAD_TIMEOUT_MS });
    await fs.chmod(uptermPath, 0o755);
  };

  if (proxiedUrl) {
    try {
      await downloadAsync(proxiedUrl);
      return { uptermPath, downloadDir };
    } catch (err) {
      logger.debug(
        { err },
        'Failed to download upterm through the cache proxy; falling back to the direct URL.'
      );
      await fs.rm(uptermPath, { force: true }).catch(() => {});
    }
  }

  try {
    await downloadAsync(directUrl);
  } catch (err) {
    await fs.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
    throw new SystemError(
      `The upterm SSH client could not be downloaded from ${directUrl}. ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return { uptermPath, downloadDir };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function spawnOutput(err: unknown): string {
  const { stdout, stderr } = err as Partial<SpawnResult>;
  return redactConnectionSecrets(`${stderr ?? ''}${stdout ?? ''}`);
}

async function readCurrentSessionStatusAsync(
  uptermPath: string,
  adminSocketPath: string,
  env: Env
): Promise<UptermSessionStatus | null> {
  let stdout: string;
  try {
    ({ stdout } = await spawn(
      uptermPath,
      ['session', 'current', '--admin-socket', adminSocketPath, '--output', 'json'],
      { stdio: 'pipe', env }
    ));
  } catch {
    return null;
  }
  const parsed = UptermCurrentSessionJsonZ.safeParse(parseJson(stdout));
  if (!parsed.success) {
    return null;
  }
  const { status, guestCount, tunnelReason } = parsed.data;
  switch (status) {
    case 'reconnecting':
      if (tunnelReason && BLOCKED_TUNNEL_REASONS.has(tunnelReason)) {
        return { state: 'gone', reason: `${status} (${tunnelReason})` };
      }
      return { state: status, connectedClientCount: guestCount };
    case 'ready':
      return { state: status, connectedClientCount: guestCount };
    case 'disconnected':
    case 'ending':
      return { state: 'gone', reason: tunnelReason ? `${status} (${tunnelReason})` : status };
    default:
      return null;
  }
}

export async function startUptermHostAsync(
  ctx: BuildContext,
  { relayServerUrl }: { relayServerUrl: string }
): Promise<UptermHost> {
  const { uptermPath, downloadDir } = await resolveUptermAsync(ctx.env, ctx.logger);

  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-ssh-'));
  const hostKeyPath = path.join(stateDir, 'id_host');
  const forceCommandPath = path.join(stateDir, 'join.sh');
  const sessionName = `eas-${randomBytes(4).toString('hex').slice(0, 7)}`;
  const env: Env = { ...ctx.env, XDG_RUNTIME_DIR: stateDir };

  await spawn('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', hostKeyPath, '-q'], {
    logger: ctx.logger,
  });
  const quotedBuildDirectory = `'${ctx.buildDirectory.replaceAll("'", "'\\''")}'`;
  await fs.writeFile(
    forceCommandPath,
    `#!/usr/bin/env bash\ncd -- ${quotedBuildDirectory}\nexec bash -l\n`,
    { mode: 0o755 }
  );

  const stopAsync = async (): Promise<void> => {
    try {
      await spawn(uptermPath, ['session', 'stop', sessionName], { stdio: 'pipe', env });
    } catch (err) {
      throw new SystemError(`Failed to stop the upterm session. Output:\n${spawnOutput(err)}`);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
      await fs.rm(downloadDir, { recursive: true, force: true });
    }
  };

  let started: z.infer<typeof UptermStartedJsonZ>;
  try {
    ctx.logger.debug('Connecting to the SSH relay.');
    let stdout: string;
    try {
      // --force-command is what each connecting SSH client runs (a login shell). The `sleep` after
      // `--` is the session's own command, which keeps it up while nobody is connected.
      ({ stdout } = await spawn(
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
          '--detach',
          '--name',
          sessionName,
          '--output',
          'json',
          '--',
          'bash',
          '-lc',
          `sleep ${UPTERM_KEEPALIVE_SLEEP_SECONDS}`,
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: CONNECTION_STARTUP_TIMEOUT_MS }
      ));
    } catch (err) {
      const failure = (err as Partial<SpawnResult>).signal
        ? `did not register with the relay within ${CONNECTION_STARTUP_TIMEOUT_MS / 1_000}s`
        : 'could not register with the relay';
      throw new SystemError(`The upterm client ${failure}. Output:\n${spawnOutput(err)}`);
    }
    const parsed = UptermStartedJsonZ.safeParse(parseJson(stdout));
    if (!parsed.success) {
      throw new SystemError(
        `The upterm client did not report a usable session. Output:\n${redactConnectionSecrets(
          stdout
        )}`
      );
    }
    started = parsed.data;
  } catch (err) {
    await stopAsync().catch(() => {});
    throw err;
  }

  const readStatusAsync = async (): Promise<UptermSessionStatus> => {
    for (let attempt = 1; attempt <= CLIENT_COUNT_READ_ATTEMPTS; attempt++) {
      const status = await readCurrentSessionStatusAsync(uptermPath, started.adminSocket, env);
      if (status) {
        return status;
      }
      if (!isProcessRunning(started.pid)) {
        return { state: 'gone', reason: 'the upterm session process exited' };
      }
      if (attempt < CLIENT_COUNT_READ_ATTEMPTS) {
        await sleepAsync(CLIENT_COUNT_READ_RETRY_MS);
      }
    }
    throw new SystemError('Could not read the SSH client count from the upterm admin socket.', {
      trackingCode: 'SSH_CLIENT_COUNT_UNREADABLE',
    });
  };

  return {
    connectionConfig: { type: 'upterm-v1', secret: started.sessionId },
    startedReconnecting: started.status === 'reconnecting',
    readStatusAsync,
    stopAsync,
  };
}
