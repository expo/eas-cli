import { once } from 'node:events';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

import { resolveHostActionRequest, runHostActionAsync } from '../hostActions';

const UDID = '90858C9D-BC34-4A0A-93D4-E4939A681A72';
const TOKEN = 'preview-token_123';

describe(resolveHostActionRequest, () => {
  it('reads a setting without a value and sets it with one', () => {
    expect(resolveHostActionRequest('hardware-keyboard', [])).toEqual({
      action: 'hardwareKeyboard.get',
      params: {},
    });
    expect(resolveHostActionRequest('text-size', ['extra-large'])).toEqual({
      action: 'textSize.set',
      params: { value: 'extra-large' },
    });
  });

  it('builds the device, debug and listing actions', () => {
    expect(resolveHostActionRequest('settings', [])).toEqual({
      action: 'settings.status',
      params: {},
    });
    expect(resolveHostActionRequest('software-keyboard', [])).toEqual({
      action: 'softwareKeyboard.toggle',
      params: {},
    });
    expect(resolveHostActionRequest('memory-warning', [])).toEqual({
      action: 'memoryWarning',
      params: {},
    });
    expect(resolveHostActionRequest('ca-debug', ['blended', 'on'])).toEqual({
      action: 'caDebug.set',
      params: { option: 'blended', value: 'on' },
    });
    expect(resolveHostActionRequest('hinge', ['half'])).toEqual({
      action: 'hinge.set',
      params: { value: 'half' },
    });
    expect(resolveHostActionRequest('hinge', ['135'])).toEqual({
      action: 'hinge.set',
      params: { value: 135 },
    });
    expect(resolveHostActionRequest('permissions', [], { bundleId: 'com.example.app' })).toEqual({
      action: 'permissions.list',
      params: { bundleId: 'com.example.app' },
    });
  });

  it('refuses an unknown name and the wrong number of values', () => {
    expect(() => resolveHostActionRequest('server-kill', [])).toThrow(
      'Unknown simulator action "server-kill"'
    );
    expect(() => resolveHostActionRequest('voiceover', ['on', 'off'])).toThrow(
      'Usage: eas simulator:action voiceover [value]'
    );
    expect(() => resolveHostActionRequest('ca-debug', ['blended'])).toThrow(
      'Usage: eas simulator:action ca-debug'
    );
    expect(() => resolveHostActionRequest('memory-warning', ['now'])).toThrow(
      'Usage: eas simulator:action memory-warning'
    );
  });

  it('refuses a flag that the action does not use', () => {
    expect(() => resolveHostActionRequest('settings', [], { bundleId: 'com.example.app' })).toThrow(
      'The --bundle-id flag works only with the permissions action.'
    );
  });

  it('sends a plain number as a number and anything else as text', () => {
    expect(resolveHostActionRequest('hinge', ['12.5'])).toEqual({
      action: 'hinge.set',
      params: { value: 12.5 },
    });
    expect(resolveHostActionRequest('hinge', [' '])).toEqual({
      action: 'hinge.set',
      params: { value: ' ' },
    });
    expect(resolveHostActionRequest('hinge', ['0x10'])).toEqual({
      action: 'hinge.set',
      params: { value: '0x10' },
    });
  });
});

describe(runHostActionAsync, () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let apiUrl: string;
  let received: unknown[];
  let requests: (string | undefined)[];
  let apiBody: string;
  let protocols: string[];
  let reply: (message: { id: number }) => Record<string, unknown> | null;

  beforeEach(async () => {
    received = [];
    requests = [];
    apiBody = JSON.stringify({ device: UDID });
    protocols = [];
    reply = message => ({ id: message.id, stdout: 'on\n', stderr: '', exitCode: 0 });
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
      handleProtocols: offered => {
        protocols = [...offered];
        return offered.has(`serve-sim.token.${TOKEN}`) ? `serve-sim.token.${TOKEN}` : false;
      },
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
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
    server.close();
    await once(server, 'close');
  });

  it('sends the action with the simulator udid and returns the reply', async () => {
    const result = await runHostActionAsync(
      { apiUrl, token: TOKEN },
      { action: 'hardwareKeyboard.set', params: { value: 'off' } }
    );

    expect(protocols).toEqual([`serve-sim.token.${TOKEN}`]);
    expect(received).toEqual([
      { id: 1, action: 'hardwareKeyboard.set', params: { value: 'off', udid: UDID } },
    ]);
    expect(result).toEqual({ stdout: 'on\n', stderr: '', exitCode: 0 });
  });

  it('keeps a path on the API URL and drops its query', async () => {
    await expect(
      runHostActionAsync(
        { apiUrl: `${apiUrl}/preview?token=${TOKEN}`, token: TOKEN },
        { action: 'memoryWarning', params: {} }
      )
    ).rejects.toThrow('refused the session token (HTTP 401)');
    expect(requests).toEqual(['/preview/api']);
  });

  it('explains that an old serve-sim does not know the action', async () => {
    reply = message => ({ id: message.id, error: 'unknown action caDebug.set' });

    await expect(
      runHostActionAsync({ apiUrl, token: TOKEN }, { action: 'caDebug.set', params: {} })
    ).rejects.toThrow('does not support this action');
  });

  it('passes a validation error from the simulator through', async () => {
    reply = message => ({
      id: message.id,
      error: 'hardwareKeyboard.set: value must be one of on, off',
    });

    await expect(
      runHostActionAsync(
        { apiUrl, token: TOKEN },
        { action: 'hardwareKeyboard.set', params: { value: 'maybe' } }
      )
    ).rejects.toThrow(
      'The simulator refused the request: hardwareKeyboard.set: value must be one of on, off'
    );
  });

  it('refuses a wrong token before it opens the socket', async () => {
    await expect(
      runHostActionAsync({ apiUrl, token: 'wrong' }, { action: 'memoryWarning', params: {} })
    ).rejects.toThrow('refused the session token (HTTP 401)');
    expect(received).toEqual([]);
  });

  it('gives up when the simulator does not answer', async () => {
    reply = () => null;

    await expect(
      runHostActionAsync(
        { apiUrl, token: TOKEN },
        { action: 'memoryWarning', params: {} },
        { timeoutMs: 100 }
      )
    ).rejects.toThrow('The simulator did not answer within');
  });

  it('explains a preview server that does not report its simulator', async () => {
    apiBody = '<html>starting</html>';

    await expect(
      runHostActionAsync({ apiUrl, token: TOKEN }, { action: 'memoryWarning', params: {} })
    ).rejects.toThrow('did not report which simulator it streams');
    expect(received).toEqual([]);
  });

  it('fails at once on a reply it cannot read', async () => {
    reply = message => ({ id: message.id, output: 'on' });

    await expect(
      runHostActionAsync({ apiUrl, token: TOKEN }, { action: 'memoryWarning', params: {} })
    ).rejects.toThrow('sent a reply that this version of eas-cli cannot read');
  });
});
