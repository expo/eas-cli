import { once } from 'node:events';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import { runServeSimActionAsync, stageServeSimAppAsync } from '../serveSimActions';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

let server: WebSocketServer;
let port: number;
const token = 'test-session-token';
const request = () => ({
  port,
  token,
  action: 'app.install',
  params: { udid: 'device', path: '/tmp/App.app' },
  timeoutMs: 2_000,
});

beforeEach(async () => {
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  for (const socket of server.clients) {
    socket.terminate();
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
});

it('authenticates the upgrade, waits for ready, and sends the action once', async () => {
  const actions: unknown[] = [];
  const upgrades: unknown[] = [];
  server.on('connection', (socket, upgrade) => {
    upgrades.push({
      url: upgrade.url,
      protocol: upgrade.headers['sec-websocket-protocol'],
    });
    socket.on('message', raw => {
      actions.push(JSON.parse(raw.toString()));
      socket.send(JSON.stringify({ id: 1, stdout: '', stderr: '', exitCode: 0 }));
    });
    socket.send(JSON.stringify({ ready: true }));
    socket.send(JSON.stringify({ ready: true }));
  });
  await runServeSimActionAsync(request());
  expect(upgrades).toEqual([{ url: '/exec-ws', protocol: `serve-sim.token.${token}` }]);
  expect(actions).toEqual([{ id: 1, action: 'app.install', params: request().params }]);
});

it.each([
  [{ id: 1, exitCode: 1, stderr: 'install refused' }, 'install refused'],
  [{ id: 1, error: 'unknown action app.install' }, 'unknown action'],
  [{ id: 1, stdout: '' }, 'invalid response'],
  [{ id: 1, exitCode: 1, stderr: '' }, 'invalid response'],
])('rejects unsuccessful action replies without retrying', async (reply, message) => {
  let attempts = 0;
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => {
      attempts++;
      socket.send(JSON.stringify(reply));
    });
  });
  await expect(runServeSimActionAsync(request())).rejects.toThrow(message);
  expect(attempts).toBe(1);
});

it('rejects a connection that closes before its action finishes', async () => {
  server.on('connection', socket => socket.close());
  await expect(runServeSimActionAsync(request())).rejects.toThrow('closed before completion');
});

it('rejects an upgrade refused by the server without executing an action', async () => {
  const connected = jest.fn();
  server.options.verifyClient = () => false;
  server.on('connection', connected);
  await expect(runServeSimActionAsync(request())).rejects.toThrow('connection failed');
  expect(connected).not.toHaveBeenCalled();
});

it('rejects malformed replies without resending the action', async () => {
  const actions = jest.fn();
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => {
      actions();
      socket.send('not JSON');
    });
  });
  await expect(runServeSimActionAsync(request())).rejects.toThrow('returned invalid JSON');
  expect(actions).toHaveBeenCalledTimes(1);
});

it('times out and closes a socket that never becomes ready', async () => {
  const disconnected = new Promise(resolve =>
    server.on('connection', socket => socket.on('close', resolve))
  );
  await expect(runServeSimActionAsync({ ...request(), timeoutMs: 30 })).rejects.toThrow(
    'timed out'
  );
  await disconnected;
});

it('aborts an in-flight action without resending it', async () => {
  const controller = new AbortController();
  let attempts = 0;
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => {
      attempts++;
      controller.abort(new Error('session stopped'));
    });
  });
  await expect(runServeSimActionAsync({ ...request(), signal: controller.signal })).rejects.toThrow(
    'session stopped'
  );
  expect(attempts).toBe(1);
});

it('does not connect when already aborted', async () => {
  const connected = jest.fn();
  server.on('connection', connected);
  await expect(
    runServeSimActionAsync({
      ...request(),
      signal: AbortSignal.abort(new Error('already stopped')),
    })
  ).rejects.toThrow('already stopped');
  expect(connected).not.toHaveBeenCalled();
});

it("stages a local app without consuming the caller's original", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-stage-test-'));
  try {
    const source = path.join(root, 'downloaded', 'App.app');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'marker'), 'app');
    await symlink('marker', path.join(source, 'current'));
    const alias = path.join(root, 'Alias.app');
    await symlink(source, alias);
    const staged = await stageServeSimAppAsync(alias, root);
    expect(staged.path).toMatch(/serve-sim-uploads\/eas-app-[^/]+\/Alias.app$/);
    expect((await lstat(staged.path)).isDirectory()).toBe(true);
    await access(path.join(staged.path, 'marker'));
    expect(await readlink(path.join(staged.path, 'current'))).toBe('marker');
    expect((await stat(path.join(root, 'serve-sim-uploads'))).mode & 0o777).toBe(0o700);
    await rm(staged.directory, { recursive: true, force: true });
    expect(await readFile(path.join(source, 'marker'), 'utf8')).toBe('app');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('removes its staging directory when the source app cannot be read', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-stage-test-'));
  try {
    await expect(stageServeSimAppAsync(path.join(root, 'Missing.app'), root)).rejects.toThrow(
      'ENOENT'
    );
    expect(await readdir(path.join(root, 'serve-sim-uploads'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
