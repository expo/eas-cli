import { createServer } from 'node:net';
import { z } from 'zod';

import {
  ControlConnectionIdentity,
  assertControlConnectionCredentialAsync,
  ensureControlConnectionDirectoryAsync,
  withControlConnectionLockAsync,
} from './controlConnection';
import {
  CONTROL_CONNECTION_VERSION,
  CONTROL_SETUP_TIMEOUT_MS,
  ConnectionOperationSchema,
  ControlConnectionChannel,
  ControlConnectionInfo,
  ControlSessionSchema,
  DEFAULT_CONTROL_IDLE_TIMEOUT_MS,
} from './controlConnectionProtocol';
import {
  HostActionCatalog,
  HostActionConnection,
  HostActionResult,
  connectHostActionsAsync,
  fetchHostActionCatalogAsync,
  fetchHostActionDeviceAsync,
} from './hostActions';

const Request = z.strictObject({
  id: z.number().int().positive(),
  action: z.string().min(1).max(200),
  params: z.record(z.string(), z.json()),
});

export async function serveControlConnectionAsync(
  identity: ControlConnectionIdentity,
  session: ControlConnectionInfo['session'],
  remote: HostActionConnection,
  catalog: HostActionCatalog,
  initialIdleTimeoutMs = DEFAULT_CONTROL_IDLE_TIMEOUT_MS
): Promise<{ closeAsync(): Promise<void>; info: ControlConnectionInfo }> {
  await ensureControlConnectionDirectoryAsync(identity.root);
  let idleTimeoutMs = initialIdleTimeoutMs;
  let idleDeadline: number | null = null;
  let timer: NodeJS.Timeout | undefined;
  let authTimer: NodeJS.Timeout | undefined;
  let closePromise: Promise<void> | undefined;
  let closeStarted: Promise<void> | undefined;
  let leaseTail = Promise.resolve();
  let leases = 0;
  let active: ControlConnectionChannel | undefined;
  const channels = new Set<ControlConnectionChannel>();
  const info = (): ControlConnectionInfo => ({
    version: CONTROL_CONNECTION_VERSION,
    pid: process.pid,
    session,
    idleTimeoutMs,
    idleDeadline,
    busy: Boolean(active),
  });

  const resetIdle = (): void => {
    clearTimeout(timer);
    idleDeadline = null;
    if (leases || closePromise) {
      return;
    }
    idleDeadline = Date.now() + idleTimeoutMs;
    timer = setTimeout(() => {
      void closeAsync();
    }, idleTimeoutMs);
  };

  async function closeAsync(requester?: ControlConnectionChannel): Promise<void> {
    if (!closePromise) {
      clearTimeout(timer);
      for (const channel of channels) {
        if (channel !== active) {
          channel.destroy();
        }
      }
      let acknowledge!: () => void;
      closeStarted = new Promise<void>(resolve => {
        acknowledge = resolve;
      });
      closePromise = (async () => {
        clearInterval(authTimer);
        await withControlConnectionLockAsync(identity, async () => {
          acknowledge();
          await leaseTail;
          await new Promise<void>((resolve, reject) =>
            server.close(error => {
              error ? reject(error) : resolve();
            })
          );
          remote.close();
        });
        remote.signal.removeEventListener('abort', onRemoteClosed);
      })().catch(() => process.exit(1));
    }
    if (requester) {
      // Every close acknowledges under ownership, including repeated close calls.
      await closeStarted;
      await requester.writeAsync(info()).catch(() => {});
      requester.socket.destroySoon();
    }
    await closePromise;
  }

  async function handleAsync(channel: ControlConnectionChannel): Promise<void> {
    const operation = ConnectionOperationSchema.parse(await channel.readAsync());
    await assertControlConnectionCredentialAsync(identity);
    if (channel.socket.destroyed) {
      return;
    }
    if (closePromise && operation.operation !== 'close') {
      throw new Error(
        'The control connection is closing; no action was sent. Try again after it closes.'
      );
    }
    if (operation.idleTimeoutMs !== undefined) {
      idleTimeoutMs = operation.idleTimeoutMs;
      resetIdle();
    }
    if (operation.operation !== 'lease') {
      if (operation.operation === 'close') {
        // Keep this caller alive until shutdown acknowledges its request.
        channels.delete(channel);
        await closeAsync(channel);
      } else {
        await channel.writeAsync(info());
      }
      return;
    }
    if (leases >= 16) {
      throw new Error(
        'The control connection is busy; no action was sent. Try again after the current command finishes.'
      );
    }
    const previous = leaseTail;
    let release!: () => void;
    leaseTail = new Promise<void>(resolve => {
      release = resolve;
    });
    leases++;
    clearTimeout(timer);
    idleDeadline = null;
    let cleanupTimer: NodeJS.Timeout | undefined;
    const limitCleanup = (): void => {
      if (closePromise && !cleanupTimer) {
        cleanupTimer = setTimeout(() => {
          channel.destroy();
        }, CONTROL_SETUP_TIMEOUT_MS);
      }
    };
    try {
      await previous;
      if (closePromise || channel.socket.destroyed) {
        return;
      }
      active = channel;
      await channel.writeAsync({ info: info(), catalog });
      for (;;) {
        const request = Request.parse(await channel.readAsync(30_000));
        await assertControlConnectionCredentialAsync(identity);
        if (channel.socket.destroyed) {
          return;
        }
        limitCleanup();
        if (closePromise && request.action !== 'upload.remove') {
          await channel.writeAsync({
            id: request.id,
            error: 'The control connection is closing; no action was sent.',
          });
          continue;
        }
        let result: HostActionResult;
        try {
          result = await remote.requestAsync(request.action, request.params);
        } catch (error) {
          remote.signal.throwIfAborted();
          await channel.writeAsync({
            id: request.id,
            error: error instanceof Error ? error.message : 'Simulator action failed.',
          });
          continue;
        } finally {
          limitCleanup();
        }
        await channel.writeAsync({ id: request.id, ...result });
      }
    } finally {
      clearTimeout(cleanupTimer);
      if (active === channel) {
        active = undefined;
      }
      leases--;
      release();
      resetIdle();
    }
  }

  const server = createServer(socket => {
    const channel = new ControlConnectionChannel(socket);
    channels.add(channel);
    socket.once('close', () => channels.delete(channel));
    void handleAsync(channel)
      .catch(async error => {
        if (!socket.destroyed) {
          await channel
            .writeAsync({
              error: error instanceof Error ? error.message : 'Local control request failed.',
            })
            .catch(() => {});
        }
      })
      .finally(() => {
        socket.destroySoon();
      });
  });
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(identity.socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const onRemoteClosed = (): void => {
    for (const channel of channels) {
      channel.destroy();
    }
    void closeAsync();
  };
  authTimer = setInterval(() => {
    void assertControlConnectionCredentialAsync(identity).catch(onRemoteClosed);
  }, 1_000);
  authTimer.unref();
  remote.signal.addEventListener('abort', onRemoteClosed, { once: true });
  if (remote.signal.aborted) {
    onRemoteClosed();
  }
  resetIdle();
  return { closeAsync, info: info() };
}

async function runWorkerAsync(): Promise<void> {
  if (!process.send) {
    throw new Error('Control helpers must be started by EAS CLI.');
  }
  process.umask(0o077);
  // Until readiness is handed back, parent loss cancels all bootstrap work.
  const onParentGone = (): never => process.exit(1);
  process.once('disconnect', onParentGone);
  const input = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Control bootstrap timed out.'));
    }, 10_000);
    process.once('message', message => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  const parsed = z
    .object({
      identity: z.object({
        root: z.string(),
        socketPath: z.string(),
        credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
        scope: z.string(),
        sessionStatePath: z.string().optional(),
      }),
      bootstrap: z.object({
        access: z.object({ apiUrl: z.string(), token: z.string() }),
        session: ControlSessionSchema.omit({ device: true }),
      }),
      idleTimeoutMs: ConnectionOperationSchema.shape.idleTimeoutMs,
    })
    .parse(input);
  const { identity, bootstrap } = parsed;
  const remote = await connectHostActionsAsync(bootstrap.access);
  try {
    const catalog = await fetchHostActionCatalogAsync(remote);
    const device = await fetchHostActionDeviceAsync(bootstrap.access, remote.udid);
    const server = await serveControlConnectionAsync(
      identity,
      { ...bootstrap.session, device },
      remote,
      catalog,
      parsed.idleTimeoutMs
    );
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        void server.closeAsync();
      });
    }
    process.removeListener('disconnect', onParentGone);
    await new Promise<void>((resolve, reject) => {
      process.send!({ ready: true, info: server.info }, (error: Error | null) => {
        error ? reject(error) : resolve();
      });
    });
  } catch (error) {
    remote.close();
    throw error;
  }
}

if (require.main === module) {
  void runWorkerAsync().catch(error => {
    if (process.connected && process.send) {
      process.send(
        { error: error instanceof Error ? error.message : 'Local control setup failed.' },
        () => process.exit(1)
      );
    } else {
      process.exit(1);
    }
  });
}
