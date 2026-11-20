import { SystemError } from '@expo/eas-build-job';
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
import { type WebSocket, WebSocketServer } from 'ws';

import {
  captureServeSimScreenshotAsync,
  runServeSimActionAsync,
  runServeSimActionWithResultAsync,
  stageServeSimAppAsync,
} from '../serveSimActions';

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

it('returns stdout from an authenticated action for catalog inspection', async () => {
  server.on('connection', socket => {
    socket.on('message', () =>
      socket.send(JSON.stringify({ id: 1, stdout: '{"actions":[]}', exitCode: 0 }))
    );
    socket.send(JSON.stringify({ ready: true }));
  });
  await expect(
    runServeSimActionWithResultAsync({ ...request(), action: 'actions.describe', params: {} })
  ).resolves.toEqual({ stdout: '{"actions":[]}' });
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

it('cancels before dispatch while waiting for ready in drain mode', async () => {
  const controller = new AbortController();
  const actions = jest.fn();
  server.on('connection', socket => {
    socket.on('message', actions);
    controller.abort(new Error('stopped before ready'));
    socket.send(JSON.stringify({ ready: true }));
  });
  await expect(
    runServeSimActionAsync({
      ...request(),
      signal: controller.signal,
      drainAfterDispatch: true,
    })
  ).rejects.toThrow('stopped before ready');
  expect(actions).not.toHaveBeenCalled();
});

it('drains dispatched actions after cancellation in drain mode', async () => {
  const controller = new AbortController();
  let reply!: () => void;
  let dispatched!: () => void;
  const ready = new Promise<void>(resolve => {
    dispatched = resolve;
  });
  server.on('connection', socket => {
    socket.send(JSON.stringify({ ready: true }));
    socket.on('message', () => {
      reply = () => socket.send(JSON.stringify({ id: 1, stdout: 'completed', exitCode: 0 }));
      dispatched();
    });
  });
  let settled = false;
  const action = runServeSimActionAsync({
    ...request(),
    signal: controller.signal,
    drainAfterDispatch: true,
  });
  void action.finally(() => {
    settled = true;
  });
  await ready;
  controller.abort(new Error('stopped after dispatch'));
  await new Promise(resolve => setImmediate(resolve));
  expect(settled).toBe(false);
  reply();
  await expect(action).resolves.toBeUndefined();
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

describe(captureServeSimScreenshotAsync, () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
  const metadata = { width: 2556, height: 1179, displayRotation: 'landscape-left' };
  const capture = (overrides: Partial<Parameters<typeof captureServeSimScreenshotAsync>[0]> = {}) =>
    captureServeSimScreenshotAsync({
      port,
      token,
      params: { udid: 'device', automation: true },
      timeoutMs: 2_000,
      waitForMetadata: true,
      ...overrides,
    });
  // serve-sim prefixes the PNG with the request id as a uint32 big-endian.
  const imageFrame = (id: number, image: Buffer) => {
    const frame = Buffer.alloc(4 + image.length);
    frame.writeUInt32BE(id);
    image.copy(frame, 4);
    return frame;
  };
  const serve = (reply: (socket: WebSocket, request: unknown) => void) => {
    const requests: unknown[] = [];
    server.on('connection', socket => {
      socket.on('message', raw => {
        const request = JSON.parse(raw.toString());
        requests.push(request);
        reply(socket, request);
      });
      socket.send(JSON.stringify({ ready: true }));
    });
    return requests;
  };

  it('requests binary output and returns the image with the metadata frame that follows', async () => {
    const requests = serve(socket => {
      // Replies for other ids are not for this capture.
      socket.send(JSON.stringify({ id: 2, error: 'not this capture' }));
      socket.send(imageFrame(1, png));
      socket.send(JSON.stringify({ id: 1, screenshotMetadata: metadata }));
    });
    await expect(capture()).resolves.toEqual({ image: png, metadata });
    expect(requests).toEqual([
      {
        id: 1,
        action: 'screenshot.capture',
        params: { udid: 'device', automation: true, output: 'binary' },
      },
    ]);
  });

  it('finishes on the image when the server does not send a metadata frame', async () => {
    serve(socket => socket.send(imageFrame(1, png)));
    await expect(capture({ waitForMetadata: false })).resolves.toEqual({ image: png });
  });

  it('waits for the metadata frame after the image when the server advertises it', async () => {
    let sendMetadata!: () => void;
    let imageSent!: () => void;
    const sent = new Promise<void>(resolve => {
      imageSent = resolve;
    });
    serve(socket => {
      socket.send(imageFrame(1, png), () => imageSent());
      sendMetadata = () => socket.send(JSON.stringify({ id: 1, screenshotMetadata: metadata }));
    });
    let settled = false;
    const capturing = capture();
    void capturing.finally(() => {
      settled = true;
    });
    await sent;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    sendMetadata();
    await expect(capturing).resolves.toEqual({ image: png, metadata });
  });

  it.each([
    [{ id: 1, error: 'Simulator is not booted' }, 'failed: Simulator is not booted'],
    // A path reply means the server ignored binary output.
    [{ id: 1, exitCode: 0, stdout: '/tmp/shot.png' }, 'failed: invalid response'],
    [{ id: 1, screenshotMetadata: metadata }, 'failed: invalid response'],
  ])('rejects the JSON reply %j without an image', async (reply, message) => {
    serve(socket => socket.send(JSON.stringify(reply)));
    const capturing = capture();
    await expect(capturing).rejects.toThrow(SystemError);
    await expect(capturing).rejects.toThrow(`serve-sim screenshot.capture ${message}`);
  });

  it.each([
    ['an error frame', JSON.stringify({ id: 1, error: 'Screenshot failed' })],
    ['a second image frame', imageFrame(1, png)],
    ['an invalid JSON frame', 'not JSON'],
  ])('returns the image alone when %s follows it', async (_description, frame) => {
    serve(socket => {
      socket.send(imageFrame(1, png));
      socket.send(frame);
    });
    await expect(capture()).resolves.toEqual({ image: png });
  });

  it('returns the image alone when the metadata frame does not arrive in time', async () => {
    serve(socket => socket.send(imageFrame(1, png)));
    await expect(capture({ metadataTimeoutMs: 30 })).resolves.toEqual({ image: png });
  });

  it('waits for the metadata frame no longer than the capture deadline', async () => {
    serve(socket => socket.send(imageFrame(1, png)));
    const started = Date.now();
    await expect(capture({ timeoutMs: 100, metadataTimeoutMs: 10_000 })).resolves.toEqual({
      image: png,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('returns the image alone when the connection closes before the metadata frame', async () => {
    serve(socket => socket.send(imageFrame(1, png), () => socket.close()));
    await expect(capture()).resolves.toEqual({ image: png });
  });

  it('stops waiting for the metadata frame on abort', async () => {
    const controller = new AbortController();
    let imageSent!: () => void;
    const sent = new Promise<void>(resolve => {
      imageSent = resolve;
    });
    serve(socket => socket.send(imageFrame(1, png), () => imageSent()));
    const capturing = capture({ signal: controller.signal });
    await sent;
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort(new Error('session stopped'));
    await expect(capturing).rejects.toThrow('session stopped');
  });

  it.each([
    ['a frame shorter than its id', Buffer.from([0, 0, 1]), 'malformed image frame'],
    ['a frame for another id', imageFrame(2, png), 'malformed image frame'],
    ['an empty image', imageFrame(1, Buffer.alloc(0)), 'returned an empty image'],
  ])('rejects %s', async (_description, frame, message) => {
    serve(socket => socket.send(frame));
    await expect(capture()).rejects.toThrow(message);
  });

  it('rejects an invalid JSON reply', async () => {
    serve(socket => socket.send('not JSON'));
    await expect(capture()).rejects.toThrow('returned invalid JSON');
  });

  it('drains a sent capture until its image before honoring abort', async () => {
    const controller = new AbortController();
    let reply!: () => void;
    let dispatched!: () => void;
    const received = new Promise<void>(resolve => {
      dispatched = resolve;
    });
    serve(socket => {
      reply = () => {
        socket.send(imageFrame(1, png));
        socket.send(JSON.stringify({ id: 1, screenshotMetadata: metadata }));
      };
      dispatched();
    });
    let settled = false;
    const capturing = capture({ signal: controller.signal });
    void capturing
      .finally(() => {
        settled = true;
      })
      .catch(() => {});
    await received;
    controller.abort(new Error('session stopped'));
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    reply();
    await expect(capturing).rejects.toThrow('session stopped');
  });

  it('stops at the image when the abort came while the capture was draining', async () => {
    const controller = new AbortController();
    let reply!: () => void;
    let dispatched!: () => void;
    const received = new Promise<void>(resolve => {
      dispatched = resolve;
    });
    serve(socket => {
      // The server sends the image but never the metadata frame.
      reply = () => socket.send(imageFrame(1, png));
      dispatched();
    });
    const capturing = capture({ signal: controller.signal, metadataTimeoutMs: 10_000 });
    await received;
    controller.abort(new Error('session stopped'));
    await new Promise(resolve => setImmediate(resolve));
    const started = Date.now();
    reply();
    await expect(capturing).rejects.toThrow('session stopped');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('times out a capture that never replies', async () => {
    serve(() => {});
    await expect(capture({ timeoutMs: 30 })).rejects.toThrow('screenshot.capture timed out');
  });
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
