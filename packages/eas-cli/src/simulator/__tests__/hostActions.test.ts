import * as fs from 'fs-extra';
import { once } from 'node:events';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';

import * as fetchModule from '../../fetch';
import {
  HostActionCatalog,
  HostActionConnection,
  assertHostActionOutputAsync,
  buildHostActionParams,
  connectHostActionsAsync,
  fetchHostActionCatalogAsync,
  formatHostActionUsage,
  saveHostActionOutputAsync,
  uploadFileAsync,
} from '../hostActions';

const UDID = '90858C9D-BC34-4A0A-93D4-E4939A681A72';
const TOKEN = 'preview-token_123';
const catalog: HostActionCatalog = require('./fixtures/hostActionCatalog.json');

function entry(name: string): HostActionCatalog[string] {
  return catalog[name];
}

describe(buildHostActionParams, () => {
  it('fills parameters in schema order', () => {
    expect(
      buildHostActionParams('permissions.set', entry('permissions.set'), [
        'grant',
        'camera',
        'com.example.app',
      ])
    ).toEqual({ action: 'grant', service: 'camera', bundleId: 'com.example.app' });
  });

  it('converts values to the types the schema accepts', () => {
    expect(
      buildHostActionParams('location.set', entry('location.set'), ['37.3349', '-122.009'])
    ).toEqual({ lat: 37.3349, lng: -122.009 });
    expect(buildHostActionParams('hinge.set', entry('hinge.set'), ['90'])).toEqual({ value: 90 });
    expect(buildHostActionParams('hinge.set', entry('hinge.set'), ['half'])).toEqual({
      value: 'half',
    });
    expect(
      buildHostActionParams('hardwareKeyboard.set', entry('hardwareKeyboard.set'), ['1'])
    ).toEqual({ value: '1' });
    expect(buildHostActionParams('location.set', entry('location.set'), ['1e1', '.5'])).toEqual({
      lat: 10,
      lng: 0.5,
    });
  });

  it('reads JSON for a parameter that takes a list', () => {
    const launch = {
      type: 'object',
      properties: {
        udid: { type: 'string' },
        bundleId: { type: 'string' },
        launchArgs: { type: 'array', items: { type: 'string' } },
      },
    };

    expect(
      buildHostActionParams('app.launch', launch, ['com.example.app', '["-FIRDebugEnabled"]'])
    ).toEqual({ bundleId: 'com.example.app', launchArgs: ['-FIRDebugEnabled'] });
    expect(buildHostActionParams('app.launch', launch, ['com.example.app', '[oops'])).toEqual({
      bundleId: 'com.example.app',
      launchArgs: '[oops',
    });
  });

  it('fills the values in order around the named ones', () => {
    expect(buildHostActionParams('location.set', entry('location.set'), ['lat=1', '2'])).toEqual({
      lat: 1,
      lng: 2,
    });
    expect(
      buildHostActionParams('permissions.set', entry('permissions.set'), [
        'action=grant',
        'camera',
        'com.example.app',
      ])
    ).toEqual({ action: 'grant', service: 'camera', bundleId: 'com.example.app' });
  });

  it('accepts named values in any order', () => {
    expect(
      buildHostActionParams('permissions.list', entry('permissions.list'), [
        'bundleId=com.example.app',
      ])
    ).toEqual({ bundleId: 'com.example.app' });
    expect(
      buildHostActionParams('camera.switch', entry('camera.switch'), [
        'target=./photo.jpg',
        'source=file',
      ])
    ).toEqual({ source: 'file', target: './photo.jpg' });
  });

  it('follows the value order the catalog gives for actions with several shapes', () => {
    expect(buildHostActionParams('app.install', entry('app.install'), ['./MyApp.ipa'])).toEqual({
      path: './MyApp.ipa',
    });
    expect(
      buildHostActionParams('camera.switch', entry('camera.switch'), ['file', './photo.jpg'])
    ).toEqual({ source: 'file', target: './photo.jpg' });
    expect(
      buildHostActionParams('camera.inject', entry('camera.inject'), [
        'com.example.app',
        'off',
        'placeholder',
      ])
    ).toEqual({ bundleId: 'com.example.app', mirror: 'off', source: 'placeholder' });
  });

  it('refuses extra values and a value given twice', () => {
    expect(() =>
      buildHostActionParams('hardwareKeyboard.set', entry('hardwareKeyboard.set'), ['on', 'off'])
    ).toThrow(
      'Too many values for hardwareKeyboard.set. Usage: eas simulator:control hardwareKeyboard.set <value>.'
    );
    expect(() =>
      buildHostActionParams('camera.switch', entry('camera.switch'), ['file', './a.jpg', './b.jpg'])
    ).toThrow('Too many values for camera.switch.');
    expect(() =>
      buildHostActionParams('hardwareKeyboard.set', entry('hardwareKeyboard.set'), [
        'value=on',
        'value=off',
      ])
    ).toThrow('value is given twice for hardwareKeyboard.set.');
  });
});

describe(formatHostActionUsage, () => {
  it('shows the required alternative file sources for an upload action', () => {
    expect(formatHostActionUsage('app.install', entry('app.install'))).toBe(
      'app.install <uploadId=...|path>'
    );
  });

  it('marks required and optional parameters', () => {
    expect(formatHostActionUsage('permissions.set', entry('permissions.set'))).toBe(
      'permissions.set <action> <service> <bundleId>'
    );
    expect(formatHostActionUsage('screenshot.capture', entry('screenshot.capture'))).toBe(
      'screenshot.capture [fileName]'
    );
    expect(formatHostActionUsage('camera.switch', entry('camera.switch'))).toBe(
      'camera.switch <source> [target]'
    );
  });
});

describe('host action transport policy', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    'http://sim.example.test',
    'http://127.0.0.1.example.test',
    'http://localhost.example.test',
    'http://[::ffff:192.0.2.1]',
    'ftp://127.0.0.1',
    'ws://127.0.0.1',
  ])('rejects %s before sending the session token', async apiUrl => {
    const fetch = jest
      .spyOn(fetchModule, 'default')
      .mockRejectedValue(new Error('Unexpected fetch'));

    await expect(connectHostActionsAsync({ apiUrl, token: TOKEN })).rejects.toThrow(
      'Simulator actions require HTTPS'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['https://sim.example.test', 'https://sim.example.test/api'],
    ['http://localhost:44370', 'http://localhost:44370/api'],
    ['http://127.0.0.1:44370', 'http://127.0.0.1:44370/api'],
    ['http://127.255.255.254:44370', 'http://127.255.255.254:44370/api'],
    ['http://2130706433:44370', 'http://127.0.0.1:44370/api'],
    ['http://[::1]:44370', 'http://[::1]:44370/api'],
  ])('accepts %s without following authenticated redirects', async (apiUrl, endpoint) => {
    const stopped = new Error('Fetch reached');
    const fetch = jest.spyOn(fetchModule, 'default').mockRejectedValue(stopped);

    await expect(connectHostActionsAsync({ apiUrl, token: TOKEN })).rejects.toBe(stopped);
    expect(fetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${TOKEN}` },
        redirect: 'error',
      })
    );
  });
});

describe('host action connection', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let apiUrl: string;
  let received: { id: number; action: string; params: Record<string, unknown> }[];
  let requests: (string | undefined)[];
  let apiBody: string;
  let uploads: Map<string, Buffer>;
  let reply: (message: {
    id: number;
    action: string;
    params: Record<string, unknown>;
  }) => Record<string, unknown> | null;
  let tmpDir: string;
  let connection: HostActionConnection | undefined;
  let closeBeforeReady: boolean;

  function serveSim(message: {
    id: number;
    action: string;
    params: Record<string, unknown>;
  }): Record<string, unknown> {
    const ok = (stdout: string): Record<string, unknown> => ({
      id: message.id,
      stdout,
      stderr: '',
      exitCode: 0,
    });
    switch (message.action) {
      case 'actions.describe':
        return ok(JSON.stringify(catalog));
      case 'upload.append': {
        const uploadId = String(message.params.uploadId);
        const chunk = Buffer.from(String(message.params.data), 'base64');
        const earlier = message.params.first ? [] : [uploads.get(uploadId) ?? Buffer.alloc(0)];
        uploads.set(uploadId, Buffer.concat([...earlier, chunk]));
        return ok(`/tmp/serve-sim-uploads/${uploadId}\n`);
      }
      case 'file.readBase64':
        return ok(Buffer.from('png bytes').toString('base64'));
      default:
        return ok('on\n');
    }
  }

  beforeEach(async () => {
    received = [];
    requests = [];
    uploads = new Map();
    apiBody = JSON.stringify({ device: UDID });
    reply = serveSim;
    closeBeforeReady = false;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'host-actions-'));
    server = http.createServer((req, res) => {
      requests.push(req.url);
      if (req.url === '/api' && req.headers.authorization === `Bearer ${TOKEN}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(apiBody);
        return;
      }
      res.writeHead(401);
      res.end();
    });
    wss = new WebSocketServer({
      server,
      path: '/exec-ws',
      handleProtocols: offered =>
        offered.has(`serve-sim.token.${TOKEN}`) ? `serve-sim.token.${TOKEN}` : false,
    });
    wss.on('connection', ws => {
      if (closeBeforeReady) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ ready: true }));
      ws.on('message', data => {
        const message = JSON.parse(data.toString());
        received.push(message);
        const response = reply(message);
        if (response) {
          ws.send(JSON.stringify(response));
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    connection?.close();
    connection = undefined;
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
    server.close();
    await once(server, 'close');
    await fs.remove(tmpDir);
  });

  async function connectAsync(timeoutMs?: number): Promise<HostActionConnection> {
    connection = await connectHostActionsAsync({ apiUrl, token: TOKEN }, { timeoutMs });
    return connection;
  }

  it('sends several requests over one connection with the simulator udid', async () => {
    const hostActions = await connectAsync();

    const results = await Promise.all([
      hostActions.requestAsync('hardwareKeyboard.get'),
      hostActions.requestAsync('hardwareKeyboard.set', { value: 'off' }),
    ]);

    expect(received).toEqual([
      { id: 1, action: 'hardwareKeyboard.get', params: { udid: UDID } },
      { id: 2, action: 'hardwareKeyboard.set', params: { value: 'off', udid: UDID } },
    ]);
    expect(results).toEqual([
      { stdout: 'on\n', stderr: '', exitCode: 0 },
      { stdout: 'on\n', stderr: '', exitCode: 0 },
    ]);
  });

  it('reads the catalog of actions', async () => {
    const hostActions = await connectAsync();

    await expect(fetchHostActionCatalogAsync(hostActions)).resolves.toEqual(catalog);
  });

  it('explains that an old serve-sim does not have the catalog', async () => {
    reply = message => ({ id: message.id, error: 'unknown action actions.describe' });
    const hostActions = await connectAsync();

    await expect(fetchHostActionCatalogAsync(hostActions)).rejects.toThrow(
      'does not support this action'
    );
  });

  it('passes a validation error from the simulator through', async () => {
    reply = message => ({
      id: message.id,
      error: 'hardwareKeyboard.set: value must be one of on, off',
    });
    const hostActions = await connectAsync();

    await expect(
      hostActions.requestAsync('hardwareKeyboard.set', { value: 'maybe' })
    ).rejects.toThrow(
      'The simulator refused the request: hardwareKeyboard.set: value must be one of on, off'
    );
  });

  it('fails a request at once on a reply it cannot read', async () => {
    reply = message => ({ id: message.id, output: 'on' });
    const hostActions = await connectAsync();

    await expect(hostActions.requestAsync('memoryWarning')).rejects.toThrow(
      'sent a reply that this version of eas-cli cannot read'
    );
  });

  it('gives up on a request the simulator does not answer', async () => {
    reply = () => null;
    const hostActions = await connectAsync(100);

    await expect(hostActions.requestAsync('memoryWarning')).rejects.toThrow(
      'The simulator did not answer within'
    );
  });

  it('keeps a path on the API URL and drops its query', async () => {
    await expect(
      connectHostActionsAsync({ apiUrl: `${apiUrl}/preview?token=${TOKEN}`, token: TOKEN })
    ).rejects.toThrow('refused the session token (HTTP 401)');
    expect(requests).toEqual(['/preview/api']);
  });

  it('refuses a wrong token before it opens the socket', async () => {
    await expect(connectHostActionsAsync({ apiUrl, token: 'wrong' })).rejects.toThrow(
      'refused the session token (HTTP 401)'
    );
    expect(wss.clients.size).toBe(0);
  });

  it('does not send the session token to an API redirect target', async () => {
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      requests.push(req.url);
      if (req.url === '/api') {
        res.writeHead(302, { Location: '/redirected-api' });
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(apiBody);
      }
    });

    await expect(connectAsync()).rejects.toThrow(/redirect/i);
    expect(requests).toEqual(['/api']);
    expect(wss.clients.size).toBe(0);
  });

  it('explains a connection that closes during setup', async () => {
    closeBeforeReady = true;

    await expect(connectHostActionsAsync({ apiUrl, token: TOKEN })).rejects.toThrow(
      'closed the connection during setup'
    );
  });

  it.each([401, 403])(
    'closes a refused HTTP %i upgrade without waiting for its body',
    async status => {
      let rejectedSocket: Duplex | undefined;
      let timer: NodeJS.Timeout | undefined;
      const closed = new Promise<void>(resolve => {
        server.removeAllListeners('upgrade');
        server.once('upgrade', (_req, socket) => {
          rejectedSocket = socket;
          socket.once('close', resolve);
          socket.on('end', () => socket.end());
          socket.write(
            `HTTP/1.1 ${status} Refused\r\nConnection: keep-alive\r\nContent-Length: 1000000\r\n\r\nrefused`
          );
        });
      });

      try {
        await expect(connectHostActionsAsync({ apiUrl, token: TOKEN })).rejects.toThrow(
          `refused the connection (HTTP ${status})`
        );
        await Promise.race([
          closed,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error('Refused upgrade socket stayed open'));
            }, 1000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        rejectedSocket?.destroy();
      }
    }
  );

  it('explains a preview server that does not report its simulator', async () => {
    apiBody = '<html>starting</html>';

    await expect(connectHostActionsAsync({ apiUrl, token: TOKEN })).rejects.toThrow(
      'did not report which simulator it streams'
    );
  });

  it('uploads a file in order and returns where the simulator host stored it', async () => {
    const localFile = path.join(tmpDir, 'MyApp.ipa');
    await fs.writeFile(localFile, 'hello simulator');
    const hostActions = await connectAsync();

    const upload = await uploadFileAsync(hostActions, localFile, { chunkBytes: 4 });

    expect(upload.uploadId).toMatch(/^eas-cli-[0-9a-f-]{36}\.ipa$/);
    expect(upload.path).toBe(`/tmp/serve-sim-uploads/${upload.uploadId}`);
    expect(uploads.get(upload.uploadId)?.toString()).toBe('hello simulator');
    expect(received.map(message => message.params.first)).toEqual([true, false, false, false]);
  });

  it('removes a partial upload when a chunk fails', async () => {
    const localFile = path.join(tmpDir, 'MyApp.ipa');
    await fs.writeFile(localFile, 'hello simulator');
    reply = message =>
      message.action === 'upload.append' && !message.params.first
        ? { id: message.id, stdout: '', stderr: 'The upload staging area is full.', exitCode: 1 }
        : serveSim(message);
    const hostActions = await connectAsync();

    await expect(uploadFileAsync(hostActions, localFile, { chunkBytes: 4 })).rejects.toThrow(
      `Could not upload ${localFile}: The upload staging area is full.`
    );
    expect(received.at(-1)).toMatchObject({
      action: 'upload.remove',
      params: { uploadId: received[0].params.uploadId },
    });
  });

  it('refuses to upload an empty file', async () => {
    const localFile = path.join(tmpDir, 'empty.png');
    await fs.writeFile(localFile, '');
    const hostActions = await connectAsync();

    await expect(uploadFileAsync(hostActions, localFile)).rejects.toThrow(`${localFile} is empty.`);
  });

  it('downloads a file the action left on the simulator host', async () => {
    const hostActions = await connectAsync();
    const outputPath = path.join(tmpDir, 'shot.png');

    const saved = await saveHostActionOutputAsync(
      hostActions,
      entry('screenshot.capture'),
      '/tmp/serve-sim-screenshots/serve-sim-screenshot-1.png\n',
      outputPath
    );

    expect(saved).toBe(outputPath);
    expect(received.at(-1)).toMatchObject({
      action: 'file.readBase64',
      params: { path: '/tmp/serve-sim-screenshots/serve-sim-screenshot-1.png' },
    });
    expect(await fs.readFile(outputPath, 'utf8')).toBe('png bytes');
  });

  it('saves into a folder under the name the host gave the file', async () => {
    const hostActions = await connectAsync();

    const saved = await saveHostActionOutputAsync(
      hostActions,
      entry('screenshot.capture'),
      '/tmp/serve-sim-screenshots/serve-sim-screenshot-1.png\n',
      tmpDir
    );

    expect(saved).toBe(path.join(tmpDir, 'serve-sim-screenshot-1.png'));
    expect(await fs.readFile(path.join(tmpDir, 'serve-sim-screenshot-1.png'), 'utf8')).toBe(
      'png bytes'
    );
  });

  it('does not replace a file it named itself', async () => {
    const existing = path.join(tmpDir, 'serve-sim-screenshot-1.png');
    await fs.writeFile(existing, 'mine');
    const hostActions = await connectAsync();

    await expect(
      saveHostActionOutputAsync(
        hostActions,
        entry('screenshot.capture'),
        '/tmp/serve-sim-screenshots/serve-sim-screenshot-1.png\n',
        tmpDir
      )
    ).rejects.toThrow(`${existing} already exists.`);
    expect(await fs.readFile(existing, 'utf8')).toBe('mine');
  });

  it('saves file contents the action returned', async () => {
    const hostActions = await connectAsync();
    const outputPath = path.join(tmpDir, 'Info.plist');

    await saveHostActionOutputAsync(
      hostActions,
      entry('file.readBase64'),
      Buffer.from('plist').toString('base64'),
      outputPath
    );

    expect(await fs.readFile(outputPath, 'utf8')).toBe('plist');
  });

  it('saves nothing for an action that returns no file', async () => {
    const hostActions = await connectAsync();

    await expect(
      saveHostActionOutputAsync(hostActions, entry('hardwareKeyboard.set'), 'on', undefined)
    ).resolves.toBeNull();
  });
});

describe(assertHostActionOutputAsync, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'host-action-output-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('allows --output only for actions that return a file', async () => {
    await expect(
      assertHostActionOutputAsync('app.container', entry('app.container'), './out')
    ).rejects.toThrow('app.container does not return a file, so --output does not apply.');
    await expect(
      assertHostActionOutputAsync('screenshot.capture', entry('screenshot.capture'), undefined)
    ).resolves.toBeUndefined();
    await expect(
      assertHostActionOutputAsync('screenshot.capture', entry('screenshot.capture'), tmpDir)
    ).resolves.toBeUndefined();
  });

  it('needs a file path for an action that returns file contents', async () => {
    await expect(
      assertHostActionOutputAsync('file.readBase64', entry('file.readBase64'), undefined)
    ).rejects.toThrow('file.readBase64 returns a file. Pass --output with the path to save it to.');
    await expect(
      assertHostActionOutputAsync('file.readBase64', entry('file.readBase64'), tmpDir)
    ).rejects.toThrow(`${tmpDir} is a folder. Pass --output with a file path for file.readBase64.`);
  });

  it('refuses a path in a folder that does not exist', async () => {
    const missing = path.join(tmpDir, 'missing', 'shot.png');

    await expect(
      assertHostActionOutputAsync('screenshot.capture', entry('screenshot.capture'), missing)
    ).rejects.toThrow(`The folder for ${missing} does not exist.`);
    await expect(
      assertHostActionOutputAsync(
        'screenshot.capture',
        entry('screenshot.capture'),
        path.join(tmpDir, 'missing') + path.sep
      )
    ).rejects.toThrow('does not exist');
  });
});
