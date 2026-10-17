import { AddressInfo } from 'net';
import nock from 'nock';
import { WebSocketServer } from 'ws';

import {
  UnsupportedServeSimHostActionError,
  getServeSimDeviceUdidAsync,
  getServeSimHost,
  runServeSimHostActionAsync,
} from '../serveSimHost';
import { DeviceRunSessionRemoteConfig } from '../utils';

const TOKEN = 'preview-token';
const UDID = '5B3A2F1E-0C4D-4E8F-9A7B-1C2D3E4F5A6B';

describe(getServeSimHost, () => {
  it('reads the web preview host of a controller session', () => {
    expect(
      getServeSimHost({
        __typename: 'ArgentRunSessionRemoteConfig',
        toolsUrl: 'https://argent.example.com',
        previewApiUrl: 'https://preview.example.com',
        webPreviewToken: TOKEN,
      } as DeviceRunSessionRemoteConfig)
    ).toEqual({ apiUrl: 'https://preview.example.com', token: TOKEN });
  });

  it('reads the preview host of a serve-sim session', () => {
    expect(
      getServeSimHost({
        __typename: 'ServeSimRunSessionRemoteConfig',
        previewApiUrl: 'https://preview.example.com',
        previewToken: TOKEN,
      } as DeviceRunSessionRemoteConfig)
    ).toEqual({ apiUrl: 'https://preview.example.com', token: TOKEN });
  });

  it('returns null before the session reports its preview host', () => {
    expect(
      getServeSimHost({
        __typename: 'AgentDeviceRunSessionRemoteConfig',
        previewApiUrl: null,
        webPreviewToken: TOKEN,
      } as DeviceRunSessionRemoteConfig)
    ).toBeNull();
  });
});

describe(getServeSimDeviceUdidAsync, () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('reads the device from the preview state with the session token', async () => {
    nock('https://preview.example.com', {
      reqheaders: { authorization: `Bearer ${TOKEN}` },
    })
      .get('/api')
      .reply(200, { device: UDID, port: 3200 });

    await expect(
      getServeSimDeviceUdidAsync({ apiUrl: 'https://preview.example.com', token: TOKEN })
    ).resolves.toBe(UDID);
  });

  it('fails when no simulator is running', async () => {
    nock('https://preview.example.com').get('/api').reply(200, 'null');

    await expect(
      getServeSimDeviceUdidAsync({ apiUrl: 'https://preview.example.com', token: TOKEN })
    ).rejects.toThrow('no running simulator');
  });
});

describe(runServeSimHostActionAsync, () => {
  let server: WebSocketServer;
  let apiUrl: string;
  let reply: (request: { id: number; action: string; params: unknown }) => unknown;
  let protocols: string[];
  let requests: unknown[];

  beforeEach(async () => {
    protocols = [];
    requests = [];
    server = new WebSocketServer({
      port: 0,
      path: '/exec-ws',
      handleProtocols: offered => {
        protocols = [...offered];
        return offered.values().next().value ?? false;
      },
    });
    server.on('connection', socket => {
      socket.send(JSON.stringify({ ready: true }));
      socket.on('message', data => {
        const request = JSON.parse(data.toString());
        requests.push(request);
        socket.send(JSON.stringify(reply(request)));
      });
    });
    await new Promise<void>(resolve => {
      server.once('listening', resolve);
    });
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => {
      server.close(() => {
        resolve();
      });
    });
  });

  it('runs one action over the token-authenticated exec channel', async () => {
    reply = ({ id }) => ({ id, stdout: '', stderr: '', exitCode: 0 });

    await expect(
      runServeSimHostActionAsync({ apiUrl, token: TOKEN }, 'appearance.set', {
        udid: UDID,
        value: 'dark',
      })
    ).resolves.toEqual({ stdout: '', stderr: '' });
    expect(protocols).toEqual([`serve-sim.token.${TOKEN}`]);
    expect(requests).toEqual([
      { id: 1, action: 'appearance.set', params: { udid: UDID, value: 'dark' } },
    ]);
  });

  it('reports a rejected session token', async () => {
    server.removeAllListeners('connection');
    server.on('connection', socket => {
      socket.close();
    });

    await expect(
      runServeSimHostActionAsync({ apiUrl, token: TOKEN }, 'appearance.set', {
        udid: UDID,
        value: 'dark',
      })
    ).rejects.toThrow('rejected the session token');
  });

  it('reports an action the session does not have yet', async () => {
    reply = ({ id, action }) => ({ id, error: `unknown action ${action}` });

    await expect(
      runServeSimHostActionAsync({ apiUrl, token: TOKEN }, 'springboard.restart', { udid: UDID })
    ).rejects.toThrow(UnsupportedServeSimHostActionError);
  });

  it('reports a failed command with its stderr', async () => {
    reply = ({ id }) => ({ id, stdout: '', stderr: 'Invalid device\n', exitCode: 148 });

    await expect(
      runServeSimHostActionAsync({ apiUrl, token: TOKEN }, 'appearance.set', {
        udid: UDID,
        value: 'dark',
      })
    ).rejects.toThrow('appearance.set failed: Invalid device');
  });
});
