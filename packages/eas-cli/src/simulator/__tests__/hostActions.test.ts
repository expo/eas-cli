import * as fs from 'fs-extra';
import { once } from 'node:events';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import {
  HostActionCatalog,
  HostActionConnection,
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

  it('fills the file parameter of an action whose schema has several shapes', () => {
    expect(buildHostActionParams('app.install', entry('app.install'), ['./MyApp.ipa'])).toEqual({
      path: './MyApp.ipa',
    });
    expect(
      buildHostActionParams('camera.switch', entry('camera.switch'), ['source=file', './photo.jpg'])
    ).toEqual({ source: 'file', target: './photo.jpg' });
  });

  it('refuses extra values and a value given twice', () => {
    expect(() =>
      buildHostActionParams('hardwareKeyboard.set', entry('hardwareKeyboard.set'), ['on', 'off'])
    ).toThrow(
      'Too many values for hardwareKeyboard.set. Usage: eas simulator:control hardwareKeyboard.set <value>.'
    );
    expect(() =>
      buildHostActionParams('camera.switch', entry('camera.switch'), ['file', './photo.jpg'])
    ).toThrow('Too many values for camera.switch.');
    expect(() =>
      buildHostActionParams('hardwareKeyboard.set', entry('hardwareKeyboard.set'), [
        'on',
        'value=off',
      ])
    ).toThrow('value is given twice for hardwareKeyboard.set.');
  });
});

describe(formatHostActionUsage, () => {
  it('marks required and optional parameters', () => {
    expect(formatHostActionUsage('permissions.set', entry('permissions.set'))).toBe(
      'permissions.set <action> <service> <bundleId>'
    );
    expect(formatHostActionUsage('screenshot.capture', entry('screenshot.capture'))).toBe(
      'screenshot.capture [fileName]'
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
    expect(received).toEqual([]);
  });

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
      {},
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

  it('saves a file the action returned and needs a name for it', async () => {
    const hostActions = await connectAsync();
    const outputPath = path.join(tmpDir, 'Info.plist');

    await saveHostActionOutputAsync(
      hostActions,
      entry('file.readBase64'),
      {},
      Buffer.from('plist').toString('base64'),
      outputPath
    );

    expect(await fs.readFile(outputPath, 'utf8')).toBe('plist');
    await expect(
      saveHostActionOutputAsync(hostActions, { output: 'base64' }, {}, '', undefined)
    ).rejects.toThrow('Pass --output with the path to save it to.');
  });

  it('saves nothing for an action that returns no file', async () => {
    const hostActions = await connectAsync();

    await expect(
      saveHostActionOutputAsync(hostActions, entry('hardwareKeyboard.set'), {}, 'on', undefined)
    ).resolves.toBeNull();
  });
});
