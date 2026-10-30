import * as fs from 'fs-extra';
import { execFileSync, fork } from 'node:child_process';
import { createServer } from 'node:http';
import { Socket, createConnection, createServer as createLocalServer } from 'node:net';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import { DeviceRunSessionStatus } from '../../graphql/generated';
import {
  ControlConnectionIdentity,
  assertControlConnectionCredentialAsync,
  borrowControlConnectionAsync,
  createControlConnectionIdentityAsync,
  ensureControlConnectionDirectoryAsync,
  inspectControlConnectionAsync,
  openControlConnectionAsync,
  withControlConnectionLockAsync,
} from '../controlConnection';
import {
  CONTROL_LEASE_WAIT_TIMEOUT_MS,
  CONTROL_SETUP_TIMEOUT_MS,
  ControlConnectionChannel,
  ControlConnectionInfo,
} from '../controlConnectionProtocol';
import { serveControlConnectionAsync } from '../controlConnectionWorker';
import { connectHostActionsAsync } from '../hostActions';

jest.mock('fs-extra', () => {
  const actual = jest.requireActual<typeof import('fs-extra')>('fs-extra');
  return { ...actual, mkdir: jest.fn(actual.mkdir), realpathSync: jest.fn(actual.realpathSync) };
});
const originalFs = jest.requireActual<typeof import('fs-extra')>('fs-extra');
jest.mock('../controlConnection', () => {
  const actual = jest.requireActual<typeof import('../controlConnection')>('../controlConnection');
  return {
    ...actual,
    assertControlConnectionCredentialAsync: jest.fn(actual.assertControlConnectionCredentialAsync),
  };
});

jest.setTimeout(20_000);

const workerPath = path.resolve(__dirname, '../../../build/simulator/controlConnectionWorker.js');
const pauseAsync = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms));
};

describe('persistent simulator control connection', () => {
  let dir: string;
  let identity: ControlConnectionIdentity;
  let apiUrl: string;
  let upgrades: number;
  let calls: { action: string; params: Record<string, unknown> }[];
  let hold: (() => void) | undefined;
  let holdCatalog: boolean;
  let localService: Awaited<ReturnType<typeof serveControlConnectionAsync>> | undefined;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer preview-fixture') {
      response.writeHead(401).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(
        request.url === '/api'
          ? { device: 'device-one' }
          : {
              devices: [{ device: 'device-one', name: 'Fixture phone', runtime: 'iOS 27.1' }],
            }
      )
    );
  });
  const sockets = new WebSocketServer({ server });
  const catalog = {
    'clipboard.read': { type: 'object' },
    'clipboard.write': { type: 'object' },
    slow: { type: 'object' },
    large: { type: 'object' },
    refused: { type: 'object' },
  };

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing fixture address');
    }
    apiUrl = 'http://127.0.0.1:' + address.port;
    sockets.on('connection', (socket, request) => {
      if (request.headers['sec-websocket-protocol'] !== 'serve-sim.token.preview-fixture') {
        socket.close();
        return;
      }
      upgrades++;
      socket.send(JSON.stringify({ ready: true }));
      socket.on('message', data => {
        const request: { id: number; action: string; params: Record<string, unknown> } = JSON.parse(
          data.toString()
        );
        if (request.action === 'refused' || request.action === 'unlisted') {
          calls.push(request);
          socket.send(
            JSON.stringify({
              id: request.id,
              error:
                request.action === 'unlisted'
                  ? 'unknown action unlisted'
                  : 'Action refused by fixture',
            })
          );
          return;
        }
        const answer = (): void => {
          if (socket.readyState === socket.OPEN) {
            socket.send(
              JSON.stringify({
                id: request.id,
                stdout:
                  request.action === 'actions.describe'
                    ? JSON.stringify(catalog)
                    : request.action === 'large'
                      ? 'x'.repeat(17 * 1024 * 1024)
                      : String(request.params.text ?? 'fixture result'),
                stderr: '',
                exitCode: 0,
              })
            );
          }
        };
        if (request.action !== 'actions.describe') {
          calls.push(request);
        }
        if (request.action === 'slow' || (request.action === 'actions.describe' && holdCatalog)) {
          hold = answer;
        } else {
          answer();
        }
      });
    });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(fs.realpathSync('/tmp'), 'ctl-'));
    identity = await createControlConnectionIdentityAsync(
      'session-one',
      dir,
      { accessToken: 'credential-fixture', sessionSecret: null },
      path.join(dir, 'ipc')
    );
    upgrades = 0;
    calls = [];
    hold = undefined;
    holdCatalog = false;
    localService = undefined;
  });

  afterEach(async () => {
    hold?.();
    await inspectControlConnectionAsync(identity, { operation: 'close' }).catch(() => {});
    await localService?.closeAsync();
    const deadline = Date.now() + 5_000;
    while (await fs.pathExists(identity.socketPath)) {
      if (Date.now() > deadline) {
        throw new Error('Owned helper did not close');
      }
      await pauseAsync(20);
    }
    await fs.remove(dir);
  });

  afterAll(async () => {
    for (const socket of sockets.clients) {
      socket.terminate();
    }
    await new Promise<void>(resolve => {
      sockets.close(() => {
        resolve();
      });
    });
    await new Promise<void>(resolve =>
      server.close(() => {
        resolve();
      })
    );
  });

  const load = jest.fn(async () => ({
    access: { apiUrl, token: 'preview-fixture' },
    session: {
      id: 'session-one',
      name: 'Fixture session',
      project: '@fixture/app',
      status: DeviceRunSessionStatus.InProgress,
    },
  }));
  const openAsync = async (timeout?: number): Promise<ControlConnectionInfo> =>
    await openControlConnectionAsync(identity, load, timeout, workerPath);

  const openInProcessAsync = async (timeout?: number): Promise<ControlConnectionInfo> => {
    const bootstrap = await load();
    const remote = await connectHostActionsAsync(bootstrap.access);
    localService = await serveControlConnectionAsync(
      identity,
      { ...bootstrap.session, device: { udid: remote.udid } },
      remote,
      catalog,
      timeout
    );
    return localService.info;
  };

  const implementations = [
    { mode: 'child process', open: openAsync },
    { mode: 'in process', open: openInProcessAsync },
  ];

  it('discovers an absent helper without creating files, even when mkdir is denied', async () => {
    const mkdir = jest
      .mocked(fs.mkdir)
      .mockClear()
      .mockImplementation(() => {
        throw Object.assign(new Error('read-only'), { code: 'EROFS' });
      });
    try {
      await expect(borrowControlConnectionAsync(identity)).resolves.toBeNull();
      await expect(inspectControlConnectionAsync(identity)).resolves.toBeNull();
      expect(mkdir).not.toHaveBeenCalled();
      expect(await fs.pathExists(identity.root)).toBe(false);
      await expect(openAsync()).rejects.toThrow('read-only');
    } finally {
      mkdir.mockImplementation(originalFs.mkdir);
    }
  });

  it('does not resolve /tmp while deriving a discovery path', async () => {
    const realpath = jest
      .mocked(fs.realpathSync)
      .mockClear()
      .mockImplementation(() => {
        throw new Error('missing /tmp');
      });
    try {
      await expect(
        createControlConnectionIdentityAsync('session-one', dir, {
          accessToken: 'credential-fixture',
          sessionSecret: null,
        })
      ).resolves.toHaveProperty('socketPath');
      expect(realpath).not.toHaveBeenCalled();
    } finally {
      realpath.mockImplementation(originalFs.realpathSync);
    }
  });

  it('treats an intervening regular file as an absent helper during discovery', async () => {
    await fs.writeFile(identity.root, 'not a directory');
    await expect(borrowControlConnectionAsync(identity)).resolves.toBeNull();
  });

  it.each([
    { operation: 'lease' as const, outcome: 'timeout' },
    { operation: 'close' as const, outcome: 'timeout' },
    { operation: 'close' as const, outcome: 'disconnect' },
  ])(
    'reports a $operation $outcome without suggesting any simulator action ran',
    async ({ operation, outcome }) => {
      await ensureControlConnectionDirectoryAsync(identity.root);
      let peer: Socket | undefined;
      let receive!: (value: unknown) => void;
      const received = new Promise<unknown>(resolve => {
        receive = resolve;
      });
      const fake = createLocalServer(socket => {
        peer = socket;
        void new ControlConnectionChannel(socket).readAsync().then(receive);
      });
      await new Promise<void>(resolve => fake.listen(identity.socketPath, resolve));
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      try {
        const waiting =
          operation === 'lease'
            ? borrowControlConnectionAsync(identity)
            : inspectControlConnectionAsync(identity, { operation });
        const rejected = expect(waiting).rejects.toThrow(
          operation === 'lease'
            ? 'busy; no action was sent'
            : 'Close could not be confirmed; no simulator action was sent.'
        );
        expect(await received).toEqual({ operation });
        if (outcome === 'disconnect') {
          peer?.destroy();
        } else {
          jest.advanceTimersByTime(CONTROL_LEASE_WAIT_TIMEOUT_MS);
        }
        await rejected;
      } finally {
        jest.useRealTimers();
        peer?.destroy();
        await new Promise<void>(resolve =>
          fake.close(() => {
            resolve();
          })
        );
      }
    }
  );

  it('reuses one remote socket across calls, updates its timeout, and keeps credentials out of files', async () => {
    load.mockClear();
    const first = await openAsync();
    expect(first.idleTimeoutMs).toBe(120_000);
    const borrowed = await borrowControlConnectionAsync(identity);
    if (!borrowed) {
      throw new Error('Missing connection');
    }
    await expect(
      borrowed.connection.requestAsync('clipboard.write', { text: 'héllo\nworld' })
    ).resolves.toMatchObject({ stdout: 'héllo\nworld' });
    borrowed.connection.close();
    const second = await openAsync(300_000);
    expect(second.pid).toBe(first.pid);
    expect(second.idleTimeoutMs).toBe(300_000);
    expect(load).toHaveBeenCalledTimes(1);
    const again = await borrowControlConnectionAsync(identity);
    await again?.connection.requestAsync('clipboard.read');
    again?.connection.close();
    expect(upgrades).toBe(1);
    expect(calls.every(call => call.params.udid === 'device-one')).toBe(true);
    expect(await fs.readdir(identity.root)).toEqual([path.basename(identity.socketPath)]);
    expect((await fs.stat(identity.root)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(identity.socketPath)).mode & 0o077).toBe(0);
  });

  it('concurrent opens publish one helper and one remote connection', async () => {
    const infos = await Promise.all([openAsync(), openAsync(), openAsync()]);
    expect(new Set(infos.map(info => info.pid)).size).toBe(1);
    expect(upgrades).toBe(1);
  });

  it.each(['status', 'close'] as const)(
    'flushes a %s reply and finishes shutdown even when the caller leaves its socket half open',
    async operation => {
      await openAsync();
      const peer = createConnection({ path: identity.socketPath, allowHalfOpen: true });
      try {
        const ended = new Promise<void>(resolve => peer.once('end', resolve));
        let reply = '';
        peer.on('data', data => {
          reply += data.toString();
        });
        peer.write(JSON.stringify({ operation }) + '\n');
        await ended;
        expect(JSON.parse(reply)).toMatchObject({ version: 3, session: { id: 'session-one' } });
        if (operation === 'status') {
          await inspectControlConnectionAsync(identity, { operation: 'close' });
        }
        const deadline = Date.now() + 3_000;
        while (await fs.pathExists(identity.socketPath + '.lock')) {
          if (Date.now() > deadline) {
            throw new Error('Half-open caller blocked shutdown');
          }
          await pauseAsync(10);
        }
        expect(upgrades).toBe(1);
        expect(calls).toEqual([]);
      } finally {
        peer.destroy();
      }
    }
  );

  it('hands a ready helper to later CLI calls across repeated open/close cycles', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const info = await openAsync();
      expect(info.session.device.udid).toBe('device-one');
      const borrowed = await borrowControlConnectionAsync(identity);
      if (!borrowed) {
        throw new Error('Helper disappeared at readiness handoff');
      }
      await borrowed.connection.requestAsync('clipboard.read');
      borrowed.connection.close();
      await inspectControlConnectionAsync(identity, { operation: 'close' });
    }
    expect(upgrades).toBe(5);
  });

  it.each(implementations)(
    'bounds the lease queue and admits waiting callers in turn ($mode)',
    async ({ open }) => {
      await open();
      const first = await borrowControlConnectionAsync(identity);
      if (!first) {
        throw new Error('Missing connection');
      }
      const slow = first.connection.requestAsync('slow');
      while (!hold) {
        await pauseAsync(10);
      }
      let busy!: () => void;
      const rejected = new Promise<void>(resolve => {
        busy = resolve;
      });
      const waiting = Array.from({ length: 16 }, async () => {
        try {
          const borrowed = await borrowControlConnectionAsync(identity);
          borrowed?.connection.close();
          return true;
        } catch (error) {
          expect((error as Error).message).toContain('busy; no action was sent');
          busy();
          return false;
        }
      });
      await rejected;
      expect(calls.map(call => call.action)).toEqual(['slow']);
      hold();
      await slow;
      first.connection.close();
      const results = await Promise.all(waiting);
      expect(results.filter(Boolean)).toHaveLength(15);
    }
  );

  it.each(implementations)(
    'keeps the lease usable for upload cleanup after a refused action ($mode)',
    async ({ open }) => {
      await open();
      const borrowed = await borrowControlConnectionAsync(identity);
      if (!borrowed) {
        throw new Error('Missing connection');
      }
      try {
        await expect(borrowed.connection.requestAsync('refused')).rejects.toThrow(
          'Action refused by fixture'
        );
        await borrowed.connection.requestAsync('upload.remove', { uploadId: 'failed-upload' });
        expect(calls.map(call => call.action)).toEqual(['refused', 'upload.remove']);
        expect(upgrades).toBe(1);
      } finally {
        borrowed.connection.close();
      }
    }
  );

  it('reports the preview error when helper startup fails', async () => {
    await expect(
      openControlConnectionAsync(
        identity,
        async () => ({ ...(await load()), access: { apiUrl, token: 'invalid-token' } }),
        undefined,
        workerPath
      )
    ).rejects.toThrow('The simulator preview server refused the session token (HTTP 401)');
    expect(await inspectControlConnectionAsync(identity)).toBeNull();
  });

  it('uses the existing lowercase HTTPS proxy setting inside the helper', async () => {
    const proxy = createServer();
    const connections = new Set<Socket>();
    let tunnels = 0;
    proxy.on('connection', socket => {
      connections.add(socket);
      socket.once('close', () => connections.delete(socket));
    });
    proxy.on('connect', (_request, socket, head) => {
      tunnels++;
      const upstream = createConnection(Number(new URL(apiUrl).port), '127.0.0.1');
      connections.add(upstream);
      upstream.once('error', () => socket.destroy());
      socket.once('error', () => upstream.destroy());
      socket.once('close', () => upstream.destroy());
      upstream.once('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing proxy fixture address');
    }
    const previous = process.env.https_proxy;
    process.env.https_proxy = 'http://127.0.0.1:' + address.port;
    try {
      await openAsync();
      const borrowed = await borrowControlConnectionAsync(identity);
      try {
        await borrowed?.connection.requestAsync('clipboard.read');
      } finally {
        borrowed?.connection.close();
      }
      expect(tunnels).toBeGreaterThan(0);
      expect(calls.map(call => call.action)).toEqual(['clipboard.read']);
    } finally {
      if (previous === undefined) {
        delete process.env.https_proxy;
      } else {
        process.env.https_proxy = previous;
      }
      await inspectControlConnectionAsync(identity, { operation: 'close' });
      for (const socket of connections) {
        socket.destroy();
      }
      await new Promise<void>(resolve =>
        proxy.close(() => {
          resolve();
        })
      );
    }
  });

  it('cancels remote startup immediately if its parent disconnects before readiness', async () => {
    holdCatalog = true;
    const child = fork(workerPath, [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const exited = new Promise<number | null>(resolve => {
      child.once('exit', resolve);
    });
    try {
      child.send({
        identity,
        bootstrap: await load(),
      });
      const deadline = Date.now() + 5_000;
      while (!hold) {
        if (Date.now() > deadline) {
          throw new Error('Fixture catalog was not requested');
        }
        await pauseAsync(10);
      }
      child.disconnect();
      await expect(exited).resolves.toBe(1);
      expect(await inspectControlConnectionAsync(identity)).toBeNull();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      await exited;
    }
  });

  it('preserves large action replies such as file downloads over the local socket', async () => {
    await openAsync();
    const borrowed = await borrowControlConnectionAsync(identity);
    if (!borrowed) {
      throw new Error('Missing connection');
    }
    try {
      const result = await borrowed.connection.requestAsync('large');
      expect(result.stdout.length).toBe(17 * 1024 * 1024);
      expect(result.exitCode).toBe(0);
    } finally {
      borrowed.connection.close();
    }
  });

  it('recovers a crashed helper without following a cached PID or replaying an action', async () => {
    const first = await openAsync();
    const executable = execFileSync('ps', ['-p', String(first.pid), '-o', 'command='], {
      encoding: 'utf8',
    });
    expect(executable).toContain(workerPath);
    await fs.chmod(identity.socketPath, 0o755);
    process.kill(first.pid, 'SIGKILL');
    await pauseAsync(80);
    await expect(borrowControlConnectionAsync(identity)).resolves.toBeNull();
    const second = await openAsync();
    expect(second.pid).not.toBe(first.pid);
    expect(upgrades).toBe(2);
    expect(calls).toEqual([]);
  });

  it('uses private socket permissions even under a permissive umask', async () => {
    const previous = process.umask(0);
    try {
      await openAsync();
      expect((await fs.stat(identity.root)).mode & 0o777).toBe(0o700);
      expect((await fs.stat(identity.socketPath)).mode & 0o077).toBe(0);
    } finally {
      process.umask(previous);
    }
  });

  it.each(implementations)(
    'closes a session-secret helper after logout instead of retaining its authority ($mode)',
    async ({ open }) => {
      const statePath = path.join(dir, 'session.json');
      identity = await createControlConnectionIdentityAsync(
        'session-one',
        dir,
        { accessToken: null, sessionSecret: 'saved-session' },
        identity.root
      );
      identity.sessionStatePath = statePath;
      await fs.writeJson(statePath, { auth: { sessionSecret: 'saved-session' } });
      await open();
      await fs.remove(statePath);
      await pauseAsync(1_200);
      expect(await inspectControlConnectionAsync(identity)).toBeNull();
    }
  );

  it.each(implementations)(
    'expires after idle time, without expiring an active command ($mode)',
    async ({ open }) => {
      await open(1_000);
      const borrowed = await borrowControlConnectionAsync(identity);
      if (!borrowed) {
        throw new Error('Missing connection');
      }
      await pauseAsync(1_100);
      expect((await inspectControlConnectionAsync(identity))?.busy).toBe(true);
      await borrowed.connection.requestAsync('clipboard.read');
      borrowed.connection.close();
      await pauseAsync(1_200);
      expect(await inspectControlConnectionAsync(identity)).toBeNull();
    }
  );

  it.each(implementations)(
    'serializes complete caller leases and never replays an accepted action after caller loss ($mode)',
    async ({ open }) => {
      await open();
      const first = await borrowControlConnectionAsync(identity);
      if (!first) {
        throw new Error('Missing connection');
      }
      const pending = first.connection.requestAsync('slow').catch(() => {});
      while (!hold) {
        await pauseAsync(10);
      }
      const next = borrowControlConnectionAsync(identity);
      first.connection.close();
      await pending;
      await pauseAsync(30);
      expect(calls.map(call => call.action)).toEqual(['slow']);
      hold();
      const second = await next;
      await second?.connection.requestAsync('clipboard.read');
      second?.connection.close();
      expect(calls.map(call => call.action)).toEqual(['slow', 'clipboard.read']);
      expect(upgrades).toBe(1);
    }
  );

  it.each(['operation', 'action'] as const)(
    'does not dispatch a %s if its caller disconnects during credential validation',
    async phase => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const remote = {
        udid: 'device-one',
        signal: new AbortController().signal,
        requestAsync: jest.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
        close: jest.fn(),
      };
      const service = await serveControlConnectionAsync(
        identity,
        {
          ...(await load()).session,
          device: { udid: remote.udid },
        },
        remote,
        catalog
      );
      const borrowed =
        phase === 'action' ? await borrowControlConnectionAsync(identity) : undefined;
      const operation =
        phase === 'operation'
          ? new ControlConnectionChannel(createConnection(identity.socketPath))
          : undefined;
      let validate!: () => void;
      let started!: () => void;
      let disconnected!: () => void;
      const gate = new Promise<void>(resolve => {
        validate = resolve;
      });
      const validationStarted = new Promise<void>(resolve => {
        started = resolve;
      });
      const peerDisconnected = new Promise<void>(resolve => {
        disconnected = resolve;
      });
      const originalDestroy = ControlConnectionChannel.prototype.destroy;
      const destroy = jest
        .spyOn(ControlConnectionChannel.prototype, 'destroy')
        .mockImplementation(function (this: ControlConnectionChannel, error?: Error) {
          originalDestroy.call(this, error);
          if (error?.message.includes('caller disconnected')) {
            disconnected();
          }
        });
      jest.mocked(assertControlConnectionCredentialAsync).mockImplementationOnce(async () => {
        started();
        await gate;
      });
      try {
        const request = borrowed
          ? borrowed.connection.requestAsync('clipboard.write', { text: 'cancelled' })
          : operation!
              .writeAsync({ operation: 'status' })
              .then(async () => await operation!.readAsync());
        const rejected = expect(request).rejects.toThrow('closed');
        await validationStarted;
        borrowed?.connection.close();
        operation?.destroy();
        await peerDisconnected;
        validate();
        await rejected;
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(remote.requestAsync).not.toHaveBeenCalled();
      } finally {
        validate();
        borrowed?.connection.close();
        operation?.destroy();
        await service.closeAsync();
        destroy.mockRestore();
        jest
          .mocked(assertControlConnectionCredentialAsync)
          .mockReset()
          .mockImplementation(
            jest.requireActual<typeof import('../controlConnection')>('../controlConnection')
              .assertControlConnectionCredentialAsync
          );
        jest.useRealTimers();
      }
    }
  );

  it.each(implementations)(
    'acknowledges close and lets an active action finish before releasing the connection ($mode)',
    async ({ open }) => {
      await open();
      const borrowed = await borrowControlConnectionAsync(identity);
      if (!borrowed) {
        throw new Error('Missing connection');
      }
      const pending = borrowed.connection.requestAsync('slow');
      while (!hold) {
        await pauseAsync(10);
      }
      const waiting = borrowControlConnectionAsync(identity);
      const refused = expect(waiting).rejects.toThrow(/closed|disconnected/);
      await pauseAsync(20);
      const closing = await inspectControlConnectionAsync(identity, { operation: 'close' });
      expect(closing?.busy).toBe(true);
      await refused;
      await expect(inspectControlConnectionAsync(identity)).rejects.toThrow('closing; no action');
      const repeated = await inspectControlConnectionAsync(identity, { operation: 'close' });
      expect(repeated?.pid).toBe(closing?.pid);
      hold();
      await expect(pending).resolves.toMatchObject({ exitCode: 0 });
      await expect(
        borrowed.connection.requestAsync('clipboard.write', { text: 'after close' })
      ).rejects.toThrow('closing; no action was sent');
      await borrowed.connection.requestAsync('upload.remove', { uploadId: 'current-upload' });
      borrowed.connection.close();
      const deadline = Date.now() + 3_000;
      while (await fs.pathExists(identity.socketPath)) {
        if (Date.now() > deadline) {
          throw new Error('Helper did not drain and close');
        }
        await pauseAsync(20);
      }
      expect(calls.map(call => call.action)).toEqual(['slow', 'upload.remove']);
    }
  );

  it('updates the idle deadline without opening another remote socket', async () => {
    await openInProcessAsync();
    const updated = await inspectControlConnectionAsync(identity, {
      operation: 'status',
      idleTimeoutMs: 300_000,
    });
    expect(updated?.idleTimeoutMs).toBe(300_000);
    expect(updated?.idleDeadline).toBeGreaterThan(Date.now() + 290_000);
    expect(upgrades).toBe(1);
  });

  it('shuts down immediately if the remote connection was already closed at startup', async () => {
    const remote = await connectHostActionsAsync((await load()).access);
    remote.close();
    localService = await serveControlConnectionAsync(
      identity,
      { ...(await load()).session, device: { udid: remote.udid } },
      remote,
      catalog
    );
    const deadline = Date.now() + 1_000;
    while (await fs.pathExists(identity.socketPath)) {
      if (Date.now() > deadline) {
        throw new Error('Already-aborted remote connection left the helper listening');
      }
      await pauseAsync(10);
    }
    expect(await inspectControlConnectionAsync(identity)).toBeNull();
    expect(calls).toEqual([]);
  });

  it.each(implementations)(
    'bounds the cleanup window even if a closing caller keeps sending requests ($mode)',
    async ({ open }) => {
      await open();
      const borrowed = await borrowControlConnectionAsync(identity);
      if (!borrowed) {
        throw new Error('Missing connection');
      }
      await inspectControlConnectionAsync(identity, { operation: 'close' });
      let denied = 0;
      try {
        while (!borrowed.connection.signal.aborted) {
          try {
            await borrowed.connection.requestAsync('clipboard.write', { text: 'denied' });
            throw new Error('Unexpectedly admitted an action after close');
          } catch (error) {
            if (!borrowed.connection.signal.aborted) {
              expect(error).toBeInstanceOf(Error);
              expect((error as Error).message).toContain('closing; no action was sent');
              denied++;
            }
          }
          await pauseAsync(100);
        }
        expect(denied).toBeGreaterThan(0);
        expect(calls).toEqual([]);
      } finally {
        borrowed.connection.close();
      }
    }
  );

  it.each(implementations)(
    'leaves action validation to serve-sim and preserves the selected device ($mode)',
    async ({ open }) => {
      await open();
      const borrowed = await borrowControlConnectionAsync(identity);
      if (!borrowed) {
        throw new Error('Missing connection');
      }
      try {
        await expect(
          borrowed.connection.requestAsync('unlisted', { udid: 'another-device' })
        ).rejects.toThrow('does not support this action');
        expect(calls).toEqual([
          expect.objectContaining({ action: 'unlisted', params: { udid: 'device-one' } }),
        ]);
      } finally {
        borrowed.connection.close();
      }
    }
  );

  it('waits for a draining helper when reopening immediately after close', async () => {
    const original = await openAsync();
    const borrowed = await borrowControlConnectionAsync(identity);
    if (!borrowed) {
      throw new Error('Missing connection');
    }
    const pending = borrowed.connection.requestAsync('slow');
    while (!hold) {
      await pauseAsync(10);
    }
    await inspectControlConnectionAsync(identity, { operation: 'close' });
    let reopened = false;
    const next = openAsync().then(info => {
      reopened = true;
      return info;
    });
    await pauseAsync(50);
    expect(reopened).toBe(false);
    expect(upgrades).toBe(1);
    hold();
    await pending;
    borrowed.connection.close();
    expect((await next).pid).not.toBe(original.pid);
    expect(upgrades).toBe(2);
  });

  it('still drains active work if the close caller leaves before its acknowledgement', async () => {
    await openAsync();
    const borrowed = await borrowControlConnectionAsync(identity);
    if (!borrowed) {
      throw new Error('Missing connection');
    }
    const pending = borrowed.connection.requestAsync('slow');
    while (!hold) {
      await pauseAsync(10);
    }
    const channel = new ControlConnectionChannel(createConnection(identity.socketPath));
    let repeated: Promise<ControlConnectionInfo | null> | undefined;
    try {
      await withControlConnectionLockAsync(identity, async () => {
        await channel.writeAsync({ operation: 'close' });
        const deadline = Date.now() + 5_000;
        for (;;) {
          try {
            await inspectControlConnectionAsync(identity);
          } catch (error) {
            if (error instanceof Error && error.message.includes('closing')) {
              break;
            }
            throw error;
          }
          if (Date.now() > deadline) {
            throw new Error('Helper did not accept close');
          }
          await pauseAsync(10);
        }
        channel.destroy();
        let acknowledged = false;
        repeated = inspectControlConnectionAsync(identity, { operation: 'close' }).then(info => {
          acknowledged = true;
          return info;
        });
        await pauseAsync(50);
        expect(acknowledged).toBe(false);
      });
      expect(await repeated).toMatchObject({ busy: true });
      await pauseAsync(250);
      expect(borrowed.connection.signal.aborted).toBe(false);
      hold();
      await expect(pending).resolves.toMatchObject({ exitCode: 0 });
    } finally {
      channel.destroy();
      hold?.();
      borrowed.connection.close();
    }
  });

  it.each(implementations)(
    'rejects malformed operation frames and remains available to valid clients ($mode)',
    async ({ open }) => {
      await open();
      const socket = createConnection(identity.socketPath);
      const closed = new Promise<void>(resolve => {
        socket.once('close', () => {
          resolve();
        });
      });
      socket.on('error', () => {});
      socket.write('not-json\n');
      await closed;
      expect(await inspectControlConnectionAsync(identity)).not.toBeNull();
      expect(calls).toEqual([]);
    }
  );

  it('rejects unsafe root permissions, symlinks and non-socket endpoints', async () => {
    await fs.mkdir(identity.root, { mode: 0o755 });
    await expect(openAsync()).rejects.toThrow('0700');
    await fs.chmod(identity.root, 0o700);
    const target = path.join(dir, 'target');
    await fs.writeFile(target, 'untouched');
    await fs.symlink(target, identity.socketPath);
    await expect(openAsync()).rejects.toThrow('private socket');
    expect(await fs.readFile(target, 'utf8')).toBe('untouched');
    await fs.unlink(identity.socketPath);
    await fs.writeFile(identity.socketPath, 'not a socket', { mode: 0o600 });
    await expect(openAsync()).rejects.toThrow('private socket');
    await fs.unlink(identity.socketPath);
  });

  it('separates credentials, projects and sessions, and detects a replaced EAS login', async () => {
    const other = await createControlConnectionIdentityAsync(
      'session-two',
      dir,
      { accessToken: 'credential-fixture', sessionSecret: null },
      identity.root
    );
    const otherCredential = await createControlConnectionIdentityAsync(
      'session-one',
      dir,
      { accessToken: 'another-credential', sessionSecret: null },
      identity.root
    );
    expect(other.socketPath).not.toBe(identity.socketPath);
    expect(otherCredential.socketPath).not.toBe(identity.socketPath);
    const anotherProject = path.join(dir, 'another-project');
    await fs.mkdir(anotherProject);
    const projectIdentity = await createControlConnectionIdentityAsync(
      'session-one',
      anotherProject,
      { accessToken: 'credential-fixture', sessionSecret: null },
      identity.root
    );
    expect(projectIdentity.socketPath).not.toBe(identity.socketPath);
    const statePath = path.join(dir, 'login.json');
    const login = await createControlConnectionIdentityAsync(
      'session-one',
      dir,
      { accessToken: null, sessionSecret: 'saved-session' },
      identity.root
    );
    login.sessionStatePath = statePath;
    await fs.writeJson(statePath, { auth: { sessionSecret: 'saved-session' } });
    await expect(assertControlConnectionCredentialAsync(login)).resolves.toBeUndefined();
    await fs.writeJson(statePath, { auth: { sessionSecret: 'replacement-session' } });
    await expect(assertControlConnectionCredentialAsync(login)).rejects.toThrow('changed');
    await fs.remove(statePath);
    await expect(assertControlConnectionCredentialAsync(login)).rejects.toThrow('ended');
  });

  it('uses separate private runtime directories for OS users sharing an EAS token', async () => {
    const getuid = jest.spyOn(process, 'getuid');
    try {
      const authentication = { accessToken: 'shared-token', sessionSecret: null };
      getuid.mockReturnValue(501);
      const first = await createControlConnectionIdentityAsync('session-one', dir, authentication);
      getuid.mockReturnValue(502);
      const second = await createControlConnectionIdentityAsync('session-one', dir, authentication);
      expect(first.root).not.toBe(second.root);
      expect(first.socketPath).not.toBe(second.socketPath);
    } finally {
      getuid.mockRestore();
    }
  });
});

it('bounds stalled local writes so a client cannot hold a lease indefinitely', async () => {
  jest.useFakeTimers();
  const socket = new Socket();
  jest.spyOn(socket, 'write').mockReturnValue(false);
  const channel = new ControlConnectionChannel(socket);
  try {
    const pending = channel.writeAsync({ result: 'not consumed' });
    const rejected = expect(pending).rejects.toThrow('Local control write timed out');
    jest.advanceTimersByTime(CONTROL_SETUP_TIMEOUT_MS);
    await rejected;
    expect(socket.destroyed).toBe(true);
  } finally {
    channel.destroy();
    jest.useRealTimers();
  }
});
