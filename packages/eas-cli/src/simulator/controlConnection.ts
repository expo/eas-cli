import * as fs from 'fs-extra';
import { fork } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createConnection } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';

import {
  CONTROL_BOOTSTRAP_TIMEOUT_MS,
  CONTROL_CONNECTION_VERSION,
  CONTROL_LEASE_WAIT_TIMEOUT_MS,
  CONTROL_REQUEST_TIMEOUT_MS,
  CONTROL_SETUP_TIMEOUT_MS,
  ConnectionInfoSchema,
  ConnectionOperation,
  ControlConnectionChannel,
  ControlConnectionInfo,
} from './controlConnectionProtocol';
import {
  HostActionCatalog,
  HostActionCatalogSchema,
  HostActionConnection,
  HostActionReplySchema,
} from './hostActions';
import { PreviewApiAccess } from './utils';
import { getExpoApiBaseUrl } from '../api';
import { LoggedInAuthenticationInfo } from '../user/SessionManager';
import { easCliVersion } from '../utils/easCli';
import { getStateJsonPath } from '../utils/paths';

export type ControlConnectionIdentity = {
  root: string;
  socketPath: string;
  credentialHash: string;
  scope: string;
  sessionStatePath?: string;
};
export type ControlConnectionBootstrap = {
  access: PreviewApiAccess;
  session: Omit<ControlConnectionInfo['session'], 'device'>;
};
export type BorrowedControlConnection = {
  connection: HostActionConnection;
  catalog: HostActionCatalog;
  info: ControlConnectionInfo;
};

export function assertControlKeepAliveSupported(): void {
  if (process.platform === 'win32') {
    throw new Error(
      'Control keep-alive is currently supported on macOS and Linux. Regular control commands still work on Windows.'
    );
  }
}

export async function createControlConnectionIdentityAsync(
  sessionId: string,
  projectDir: string,
  authentication: LoggedInAuthenticationInfo,
  root?: string
): Promise<ControlConnectionIdentity> {
  const credential = authentication.accessToken ?? authentication.sessionSecret;
  if (!credential) {
    throw new Error('Sign in before using a simulator control connection.');
  }
  const scope = JSON.stringify([
    CONTROL_CONNECTION_VERSION,
    easCliVersion,
    path.resolve(__dirname),
    getExpoApiBaseUrl(),
    await fs.realpath(projectDir),
    sessionId,
  ]);
  const credentialHash = createHmac('sha256', credential)
    .update('eas-control-connection:' + scope)
    .digest('hex');
  const name = credentialHash.slice(0, 32);
  const runtimeName = createHmac('sha256', credential)
    .update('eas-control-runtime:' + JSON.stringify([getExpoApiBaseUrl(), process.getuid?.()]))
    .digest('hex')
    .slice(0, 24);
  root ??= path.join('/tmp', 'ectl-' + runtimeName);
  return {
    root,
    socketPath: path.join(root, name + '.sock'),
    credentialHash,
    scope,
    ...(authentication.sessionSecret ? { sessionStatePath: getStateJsonPath() } : {}),
  };
}

export async function assertControlConnectionCredentialAsync(
  identity: ControlConnectionIdentity
): Promise<void> {
  if (!identity.sessionStatePath) {
    return;
  }
  const stored = await fs.readJson(identity.sessionStatePath).catch(() => null);
  const credential: unknown = stored?.auth?.sessionSecret;
  if (typeof credential !== 'string') {
    throw new Error('The EAS login used by this connection has ended.');
  }
  const credentialHash = createHmac('sha256', credential)
    .update('eas-control-connection:' + identity.scope)
    .digest('hex');
  if (credentialHash !== identity.credentialHash) {
    throw new Error('The EAS login used by this connection has changed.');
  }
}

export async function ensureControlConnectionDirectoryAsync(root: string): Promise<void> {
  assertControlKeepAliveSupported();
  try {
    await fs.mkdir(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  await assertControlConnectionDirectoryAsync(root);
}

async function assertControlConnectionDirectoryAsync(root: string): Promise<void> {
  const stat = await fs.lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o700
  ) {
    throw new Error(
      'The local control directory must be owned by this user with permissions 0700.'
    );
  }
}

async function hasControlSocketAsync(identity: ControlConnectionIdentity): Promise<boolean> {
  try {
    const stat = await fs.lstat(identity.socketPath);
    await assertControlConnectionDirectoryAsync(identity.root);
    if (!stat.isSocket() || stat.uid !== process.getuid?.()) {
      throw new Error('The local control endpoint is not a private socket owned by this user.');
    }
    return true;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return false;
    }
    throw error;
  }
}

export async function withControlConnectionLockAsync<T>(
  identity: ControlConnectionIdentity,
  fn: () => Promise<T>
): Promise<T> {
  await ensureControlConnectionDirectoryAsync(identity.root);
  const release = await lockfile.lock(identity.socketPath, {
    realpath: false,
    stale: 10_000,
    update: 2_000,
    retries: { retries: 1_200, minTimeout: 50, maxTimeout: 200 },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function connectChannelAsync(
  identity: ControlConnectionIdentity,
  operation: ConnectionOperation
): Promise<ControlConnectionChannel | null> {
  if (process.platform === 'win32') {
    return null;
  }
  if (!(await hasControlSocketAsync(identity))) {
    return null;
  }
  const socket = createConnection(identity.socketPath);
  const channel = new ControlConnectionChannel(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error('Local control connection timed out.');
        channel.destroy(error);
        reject(error);
      }, CONTROL_SETUP_TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    // Private filesystem ownership is the authority boundary; same-UID processes are trusted.
    await channel.writeAsync(operation);
    return channel;
  } catch (error) {
    channel.destroy();
    if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return null;
    }
    throw error;
  }
}

const ReadySchema = z.object({ info: ConnectionInfoSchema, catalog: HostActionCatalogSchema });

async function readControlReplyAsync(
  channel: ControlConnectionChannel,
  timeoutMs?: number,
  timeoutMessage?: string
): Promise<unknown> {
  const reply = await channel.readAsync(timeoutMs, timeoutMessage);
  const error = z.strictObject({ error: z.string() }).safeParse(reply);
  if (error.success) {
    throw new Error(error.data.error);
  }
  return reply;
}

export async function borrowControlConnectionAsync(
  identity: ControlConnectionIdentity
): Promise<BorrowedControlConnection | null> {
  const channel = await connectChannelAsync(identity, { operation: 'lease' });
  if (!channel) {
    return null;
  }
  try {
    const { info, catalog } = ReadySchema.parse(
      await readControlReplyAsync(
        channel,
        CONTROL_LEASE_WAIT_TIMEOUT_MS,
        'The control connection is busy; no action was sent. Try again after the current command finishes.'
      )
    );
    const controller = new AbortController();
    channel.socket.once('close', () => {
      controller.abort(
        new Error('The local control connection closed. An action already sent may still have run.')
      );
    });
    let nextId = 1;
    return {
      info,
      catalog,
      connection: {
        signal: controller.signal,
        udid: info.session.device.udid,
        async requestAsync(action, params = {}) {
          controller.signal.throwIfAborted();
          if (action === 'actions.describe') {
            return { stdout: JSON.stringify(catalog), stderr: '', exitCode: 0 };
          }
          const id = nextId++;
          await channel.writeAsync({ id, action, params });
          const result = HostActionReplySchema.parse(
            await readControlReplyAsync(channel, CONTROL_REQUEST_TIMEOUT_MS)
          );
          if (result.id !== id) {
            channel.destroy();
            throw new Error('The local control reply did not match the request.');
          }
          if ('error' in result) {
            throw new Error(result.error);
          }
          return result;
        },
        close() {
          channel.destroy();
        },
      },
    };
  } catch (error) {
    channel.destroy();
    throw error;
  }
}

export async function inspectControlConnectionAsync(
  identity: ControlConnectionIdentity,
  operation: ConnectionOperation = { operation: 'status' }
): Promise<ControlConnectionInfo | null> {
  const channel = await connectChannelAsync(identity, operation);
  if (!channel) {
    return null;
  }
  try {
    const info = ConnectionInfoSchema.parse(
      await readControlReplyAsync(
        channel,
        operation.operation === 'close' ? CONTROL_LEASE_WAIT_TIMEOUT_MS : undefined,
        operation.operation === 'close'
          ? 'Close could not be confirmed; no simulator action was sent.'
          : undefined
      )
    );
    return info;
  } catch (error) {
    if (operation.operation === 'close' && channel.socket.destroyed) {
      throw new Error('Close could not be confirmed; no simulator action was sent.', {
        cause: error,
      });
    }
    throw error;
  } finally {
    channel.destroy();
  }
}

export async function openControlConnectionAsync(
  identity: ControlConnectionIdentity,
  load: () => Promise<ControlConnectionBootstrap>,
  idleTimeoutMs?: number,
  workerPath = path.join(__dirname, 'controlConnectionWorker.js')
): Promise<ControlConnectionInfo> {
  assertControlKeepAliveSupported();
  return await withControlConnectionLockAsync(identity, async () => {
    const existing = await inspectControlConnectionAsync(identity, {
      operation: 'status',
      ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
    });
    if (existing) {
      return existing;
    }
    if (await hasControlSocketAsync(identity)) {
      await fs.unlink(identity.socketPath);
    }
    const bootstrap = await load();
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'TMPDIR',
      'LANG',
      'LC_ALL',
      'EXPO_STAGING',
      'EXPO_LOCAL',
      'https_proxy',
      'NODE_EXTRA_CA_CERTS',
    ]) {
      if (process.env[key] !== undefined) {
        env[key] = process.env[key];
      }
    }
    const child = fork(workerPath, [], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: [],
      env,
      cwd: os.homedir(),
    });
    try {
      return await new Promise<ControlConnectionInfo>((resolve, reject) => {
        const timer = setTimeout(() => {
          finish(new Error('The control helper did not become ready in time.'));
        }, CONTROL_BOOTSTRAP_TIMEOUT_MS);
        const finish = (result: Error | ControlConnectionInfo): void => {
          clearTimeout(timer);
          child.removeListener('error', onError);
          child.removeListener('exit', onExit);
          child.removeListener('message', onMessage);
          result instanceof Error ? reject(result) : resolve(result);
        };
        const onError = (): void => {
          finish(new Error('Could not start the local control helper.'));
        };
        const onExit = (): void => {
          finish(new Error('The local control helper exited during setup.'));
        };
        const onMessage = (message: unknown): void => {
          const error = z.object({ error: z.string() }).safeParse(message);
          if (error.success) {
            finish(new Error(error.data.error));
          } else {
            const ready = z
              .object({ ready: z.literal(true), info: ConnectionInfoSchema })
              .safeParse(message);
            if (ready.success) {
              finish(ready.data.info);
            }
          }
        };
        child.once('error', onError);
        child.once('exit', onExit);
        child.on('message', onMessage);
        child.send({
          identity,
          bootstrap,
          idleTimeoutMs,
        });
      });
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      throw error;
    } finally {
      if (child.connected) {
        child.disconnect();
      }
      child.unref();
    }
  });
}
