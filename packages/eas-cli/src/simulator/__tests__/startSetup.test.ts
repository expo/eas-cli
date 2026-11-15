import fs from 'fs-extra';
import { once } from 'node:events';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import { readSimulatorSessionConfigAsync } from '../sessionConfig';
import { applyStartConfigAsync } from '../startSetup';

// Real HTTP/WebSocket transport and file IO verify the shared runner wiring, not just mocks.
describe(applyStartConfigAsync, () => {
  let server: http.Server;
  let sockets: WebSocketServer;
  let folder: string;
  let apiUrl: string;
  let actions: { action: string; params: Record<string, unknown> }[];
  const catalog = {
    set: {
      type: 'object',
      properties: { udid: { type: 'string' }, value: { type: 'string' } },
      required: ['udid', 'value'],
    },
    screenshot: {
      type: 'object',
      properties: { udid: { type: 'string' } },
      required: ['udid'],
      output: 'base64',
    },
  };
  beforeEach(async () => {
    actions = [];
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'start-setup-'));
    server = http.createServer((req, res) => {
      if (req.url !== '/api' || req.headers.authorization !== 'Bearer token') {
        res.writeHead(401).end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ device: 'owned-device' }));
    });
    sockets = new WebSocketServer({
      server,
      path: '/exec-ws',
      handleProtocols: protocols =>
        protocols.has('serve-sim.token.token') ? 'serve-sim.token.token' : false,
    });
    sockets.on('connection', socket => {
      socket.send(JSON.stringify({ ready: true }));
      socket.on('message', bytes => {
        const message = JSON.parse(bytes.toString());
        actions.push(message);
        const stdout =
          message.action === 'actions.describe'
            ? JSON.stringify(catalog)
            : message.action === 'screenshot'
              ? Buffer.from('image bytes').toString('base64')
              : 'done';
        socket.send(JSON.stringify({ id: message.id, stdout, stderr: '', exitCode: 0 }));
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    for (const socket of sockets.clients) {
      socket.terminate();
    }
    sockets.close();
    server.close();
    await once(server, 'close');
    await fs.remove(folder);
  });

  it('runs the captured config after the file changes, writes outputs relative to it and closes transport', async () => {
    const file = path.join(folder, 'session.json');
    await fs.writeJson(file, {
      version: 1,
      start: { platform: 'ios' },
      actions: [
        { action: 'set', params: { value: 'dark' } },
        { action: 'screenshot', output: './screen.png' },
      ],
    });
    const config = await readSimulatorSessionConfigAsync(file);
    await fs.writeJson(file, { version: 999 });
    const closed = new Promise<void>(resolve =>
      sockets.once('connection', socket => socket.once('close', resolve))
    );
    const progress = jest.fn();
    const results = await applyStartConfigAsync({ apiUrl, token: 'token' }, config, {
      signal: new AbortController().signal,
      onProgress: progress,
    });
    await closed;
    expect(results.map(result => result.action)).toEqual(['set', 'screenshot']);
    expect(await fs.readFile(path.join(folder, 'screen.png'), 'utf8')).toBe('image bytes');
    expect(actions.every(action => action.params.udid === 'owned-device')).toBe(true);
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ step: 2, total: 2, status: 'completed' })
    );
  });

  it('validates all actions before sending the first one and closes on validation failure', async () => {
    const file = path.join(folder, 'session.json');
    await fs.writeJson(file, {
      version: 1,
      actions: [{ action: 'set', params: { value: 'dark' } }, { action: 'unknown' }],
    });
    const config = await readSimulatorSessionConfigAsync(file);
    const closed = new Promise<void>(resolve =>
      sockets.once('connection', socket => socket.once('close', resolve))
    );
    await expect(
      applyStartConfigAsync({ apiUrl, token: 'token' }, config, {
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Unknown simulator action');
    await closed;
    expect(actions.map(action => action.action)).toEqual(['actions.describe']);
  });
});
