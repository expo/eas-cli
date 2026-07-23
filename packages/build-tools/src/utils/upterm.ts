import { SystemError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

export const DEFAULT_SSH_RELAY_SERVER_URL = 'wss://uptermd.upterm.dev';

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

export function parseUptermConnection(output: string): SshConnectionConfig | null {
  const completedOutput = output.slice(0, output.lastIndexOf('\n') + 1);
  // upterm prints `upterm proxy wss://<secret>@<host>`; capture secret (1) and host (2).
  const match = completedOutput.match(/upterm proxy wss:\/\/([^@\s]+)@([^\s'"]+)/);
  if (!match) {
    return null;
  }
  return { type: 'upterm-v1', host: match[2], secret: match[1] };
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

export function isUptermProcessAlive(
  child:
    | { exitCode: number | null; signalCode: NodeJS.Signals | null; killed: boolean }
    | null
    | undefined
): boolean {
  return child != null && child.exitCode === null && child.signalCode === null && !child.killed;
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

async function waitForConnectionConfigAsync(getOutput: () => string): Promise<SshConnectionConfig> {
  const deadline = Date.now() + CONNECTION_STARTUP_TIMEOUT_MS;
  for (;;) {
    const connectionConfig = parseUptermConnection(getOutput());
    if (connectionConfig) {
      return connectionConfig;
    }
    if (Date.now() >= deadline) {
      throw new SystemError(
        `The upterm client did not register with the relay within ${
          CONNECTION_STARTUP_TIMEOUT_MS / 1_000
        }s. Output:\n${redactConnectionSecrets(getOutput())}`
      );
    }
    await sleepAsync(CONNECTION_POLL_INTERVAL_MS);
  }
}

async function getConnectedClientCountAsync(
  uptermPath: string,
  uptermSocketDir: string
): Promise<number | null> {
  let result;
  try {
    const entries = await fs.readdir(uptermSocketDir).catch(() => [] as string[]);
    const socketName = entries.find(entry => entry.endsWith('.sock'));
    if (!socketName) {
      return 0;
    }
    result = await spawn(
      uptermPath,
      [
        'session',
        'current',
        '--admin-socket',
        path.join(uptermSocketDir, socketName),
        '-o',
        'go-template={{.ClientCount}}',
      ],
      { stdio: 'pipe' }
    );
  } catch {
    return null;
  }
  const clientCount = Number.parseInt(result.stdout.trim(), 10);
  return Number.isNaN(clientCount) ? null : clientCount;
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

  let currentProcess: ReturnType<typeof spawn> | null = null;

  const dialAsync = async (): Promise<SshConnectionConfig> => {
    killUptermProcessGroup(currentProcess?.child);
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
    uptermProcess.catch(err => ctx.logger.debug({ err }, 'The upterm host process exited.'));
    uptermProcess.child.unref();
    currentProcess = uptermProcess;

    let output = '';
    const appendChunk = (chunk: Buffer | string): void => {
      output += chunk.toString();
    };
    uptermProcess.child.stdout?.on('data', appendChunk);
    uptermProcess.child.stderr?.on('data', appendChunk);

    return await waitForConnectionConfigAsync(() => output);
  };

  const stopAsync = async (): Promise<void> => {
    killUptermProcessGroup(currentProcess?.child);
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
    connectionConfig,
    getConnectedClientCountAsync: () => getConnectedClientCountAsync(uptermPath, uptermSocketDir),
    isAlive: () => isUptermProcessAlive(currentProcess?.child),
    redialAsync: dialAsync,
    stopAsync,
  };
}
