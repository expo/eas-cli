import spawnAsync from '@expo/spawn-async';
import * as fs from 'fs-extra';
import { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';

import {
  EgressPolicyError,
  buildChiselClientArgs,
  classifyChiselClientLogLine,
  getChiselAssetName,
  isForbiddenEgressAddress,
  orderEgressAddresses,
  readLocalEgressConfigFromEnv,
  resolveEgressTargetAsync,
  runLocalEgressAsync,
  startLocalEgressProxyServerAsync,
} from '../egress';

jest.mock('../../log');
jest.mock('@expo/spawn-async');
jest.mock('fs-extra', () => ({
  ...jest.requireActual('fs-extra'),
  pathExists: jest.fn(),
}));

async function waitForAsync(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for socket cleanup.');
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe(isForbiddenEgressAddress, () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd12:3456::1',
    'fc00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.0.10',
    '::ffff:c0a8:a',
    'not-an-ip',
  ])('forbids %s', address => {
    expect(isForbiddenEgressAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.0.1',
    '172.32.0.1',
    '100.63.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '2001:db8::1',
    '::ffff:8.8.8.8',
  ])('allows %s', address => {
    expect(isForbiddenEgressAddress(address)).toBe(false);
  });
});

describe(resolveEgressTargetAsync, () => {
  it.each(['localhost', 'LOCALHOST', 'api.localhost', 'printer.local', '127.0.0.1', '[::1]'])(
    'refuses %s without resolving it',
    async host => {
      await expect(resolveEgressTargetAsync(host)).rejects.toBeInstanceOf(EgressPolicyError);
    }
  );

  it('returns a public IP literal unchanged', async () => {
    await expect(resolveEgressTargetAsync('1.1.1.1')).resolves.toEqual(['1.1.1.1']);
  });
});

describe(orderEgressAddresses, () => {
  it('puts IPv4 addresses first and drops duplicates', () => {
    expect(
      orderEgressAddresses([
        { address: '2600:1f13::1', family: 6 },
        { address: '34.223.124.45', family: 4 },
        { address: '34.223.124.45', family: 4 },
        { address: '2600:1f13::2', family: 6 },
      ])
    ).toEqual(['34.223.124.45', '2600:1f13::1', '2600:1f13::2']);
  });
});

describe(buildChiselClientArgs, () => {
  it('pins the server key, reconnects forever, and reverse-forwards the loopback proxy port', () => {
    expect(
      buildChiselClientArgs({
        url: 'https://egress-abc.eas-simulator.ngrok.dev',
        fingerprint: 'fp=',
        port: 8899,
      })
    ).toEqual([
      'client',
      '--fingerprint',
      'fp=',
      '--keepalive',
      '25s',
      '--max-retry-count',
      '-1',
      'https://egress-abc.eas-simulator.ngrok.dev',
      'R:127.0.0.1:8899:127.0.0.1:8899',
    ]);
  });
});

describe(classifyChiselClientLogLine, () => {
  it('recognizes chisel connection state lines', () => {
    expect(classifyChiselClientLogLine('2026/09/07 client: Connected (Latency 41ms)')).toBe(
      'connected'
    );
    expect(classifyChiselClientLogLine('2026/09/07 client: Disconnected')).toBe('disconnected');
    expect(classifyChiselClientLogLine('2026/09/07 client: Retrying in 1s...')).toBe(
      'disconnected'
    );
    expect(classifyChiselClientLogLine('2026/09/07 client: Fingerprint fp=')).toBe('other');
  });
});

describe(getChiselAssetName, () => {
  it('maps supported platforms and rejects the rest', () => {
    expect(getChiselAssetName({ platform: 'darwin', arch: 'arm64' })).toBe(
      'chisel_1.12.0_darwin_arm64.gz'
    );
    expect(getChiselAssetName({ platform: 'linux', arch: 'x64' })).toBe(
      'chisel_1.12.0_linux_amd64.gz'
    );
    expect(() => getChiselAssetName({ platform: 'win32', arch: 'x64' })).toThrow(
      'not supported on win32/x64'
    );
  });
});

describe(readLocalEgressConfigFromEnv, () => {
  it('reads the four egress variables', () => {
    expect(
      readLocalEgressConfigFromEnv({
        EAS_SIMULATOR_EGRESS_URL: 'https://egress-abc.eas-simulator.ngrok.dev',
        EAS_SIMULATOR_EGRESS_AUTH: 'eas:pw',
        EAS_SIMULATOR_EGRESS_FINGERPRINT: 'fp=',
        EAS_SIMULATOR_EGRESS_PORT: '8899',
      })
    ).toEqual({
      url: 'https://egress-abc.eas-simulator.ngrok.dev',
      auth: 'eas:pw',
      fingerprint: 'fp=',
      port: 8899,
    });
  });

  it('explains how to start a session with egress when the variables are missing', () => {
    expect(() => readLocalEgressConfigFromEnv({ EAS_SIMULATOR_SESSION_ID: 'abc' })).toThrow(
      'was not started with local egress'
    );
  });
});

describe(startLocalEgressProxyServerAsync, () => {
  // The default resolver refuses loopback, so tests inject one that maps a fake
  // public name to the local test servers.
  let targetHttpServer: http.Server;
  let targetHttpPort: number;
  let targetEchoServer: net.Server;
  let targetEchoPort: number;
  let proxy: Awaited<ReturnType<typeof startLocalEgressProxyServerAsync>>;
  const seenHostHeaders: string[] = [];

  beforeAll(async () => {
    targetHttpServer = http.createServer((req, res) => {
      seenHostHeaders.push(req.headers.host ?? '');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`hello from ${req.method} ${req.url}`);
    });
    await new Promise<void>(resolve => targetHttpServer.listen(0, '127.0.0.1', resolve));
    targetHttpPort = (targetHttpServer.address() as net.AddressInfo).port;

    targetEchoServer = net.createServer(socket => socket.pipe(socket));
    await new Promise<void>(resolve => targetEchoServer.listen(0, '127.0.0.1', resolve));
    targetEchoPort = (targetEchoServer.address() as net.AddressInfo).port;

    proxy = await startLocalEgressProxyServerAsync({
      port: 0,
      resolveTargetAsync: async hostname => {
        if (hostname === 'target.test') {
          // The test servers listen on IPv4 loopback only, so the IPv6 loopback
          // attempt is refused immediately and proves the fallback to the next address.
          return ['::1', '127.0.0.1'];
        }
        throw new EgressPolicyError(hostname);
      },
    });
  });

  afterAll(async () => {
    await proxy.closeAsync();
    await new Promise<void>(resolve => {
      targetHttpServer.close(() => {
        resolve();
      });
    });
    await new Promise<void>(resolve => {
      targetEchoServer.close(() => {
        resolve();
      });
    });
  });

  function rawRequestAsync(request: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: proxy.port });
      let response = '';
      socket.on('data', chunk => (response += chunk.toString()));
      socket.on('end', () => {
        resolve(response);
      });
      socket.on('error', reject);
      socket.on('connect', () => socket.write(request));
    });
  }

  it('uses the absolute URL authority instead of an inconsistent Host header', async () => {
    const response = await rawRequestAsync(
      `GET http://target.test:${targetHttpPort}/path?q=1 HTTP/1.1\r\nHost: wrong.test\r\nProxy-Connection: keep-alive\r\nConnection: close\r\n\r\n`
    );
    expect(response).toContain('HTTP/1.1 200');
    expect(response).toContain('hello from GET /path?q=1');
    expect(seenHostHeaders).toContain(`target.test:${targetHttpPort}`);
  });

  it('tunnels CONNECT requests to the resolved address', async () => {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: proxy.port });
      let buffer = '';
      socket.on('error', reject);
      socket.on('connect', () =>
        socket.write(`CONNECT target.test:${targetEchoPort} HTTP/1.1\r\nHost: target.test\r\n\r\n`)
      );
      socket.on('data', chunk => {
        buffer += chunk.toString();
        if (buffer.includes('200 Connection Established') && !buffer.includes('ping')) {
          socket.write('ping');
        } else if (buffer.includes('ping')) {
          socket.end();
          resolve(buffer);
        }
      });
    });
    expect(response).toContain('HTTP/1.1 200 Connection Established');
    expect(response.endsWith('ping')).toBe(true);
    expect(proxy.getStats().total).toBeGreaterThanOrEqual(2);
  });

  it('refuses destinations the policy rejects with 403', async () => {
    const connectResponse = await rawRequestAsync(
      'CONNECT internal.example:443 HTTP/1.1\r\nHost: internal.example\r\n\r\n'
    );
    expect(connectResponse).toContain('HTTP/1.1 403');

    const httpResponse = await rawRequestAsync(
      'GET http://internal.example/ HTTP/1.1\r\nHost: internal.example\r\nConnection: close\r\n\r\n'
    );
    expect(httpResponse).toContain('HTTP/1.1 403');
  });

  it('rejects requests without an absolute URL', async () => {
    const response = await rawRequestAsync(
      'GET /relative HTTP/1.1\r\nHost: target.test\r\nConnection: close\r\n\r\n'
    );
    expect(response).toContain('HTTP/1.1 400');
  });

  it.each(['GET', 'CONNECT', 'upgrade'])(
    'releases a disconnected %s client before DNS completes and never connects afterward',
    async method => {
      let resolveDns!: (addresses: string[]) => void;
      let enteredDns!: () => void;
      const started = new Promise<void>(resolve => (enteredDns = resolve));
      const deferredProxy = await startLocalEgressProxyServerAsync({
        port: 0,
        resolveTargetAsync: () => {
          enteredDns();
          return new Promise(resolve => (resolveDns = resolve));
        },
      });
      const connection = jest.fn();
      targetHttpServer.on('connection', connection);
      const client = net.connect(deferredProxy.port, '127.0.0.1');
      try {
        const target = `target.test:${targetHttpPort}`;
        client.write(
          method === 'CONNECT'
            ? `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`
            : `GET http://${target}/ HTTP/1.1\r\nHost: ${target}\r\n${method === 'upgrade' ? 'Connection: Upgrade\r\nUpgrade: websocket\r\n' : ''}\r\n`
        );
        await started;
        client.destroy();
        await waitForAsync(() => deferredProxy.getStats().active === 0);
        resolveDns(['127.0.0.1']);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(connection).not.toHaveBeenCalled();
      } finally {
        client.destroy();
        targetHttpServer.removeListener('connection', connection);
        await deferredProxy.closeAsync();
      }
    }
  );

  it('closes established CONNECT sockets without waiting for idle timeout', async () => {
    const tunnelProxy = await startLocalEgressProxyServerAsync({
      port: 0,
      resolveTargetAsync: async () => ['127.0.0.1'],
    });
    const client = net.connect(tunnelProxy.port, '127.0.0.1');
    const reply = once(client, 'data');
    client.write(`CONNECT target.test:${targetEchoPort} HTTP/1.1\r\nHost: target.test\r\n\r\n`);
    await reply;
    const closed = once(client, 'close');
    await tunnelProxy.closeAsync();
    await closed;
    expect(tunnelProxy.getStats().active).toBe(0);
    await tunnelProxy.closeAsync();
  });

  it('reframes chunked requests/responses and removes connection-nominated fields on keep-alive', async () => {
    const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
    const target = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200, {
          Connection: 'keep-alive, X-Response-Hop',
          'X-Response-Hop': 'remove-me',
          'Set-Cookie': ['a=1', 'b=2'],
        });
        res.write('response-');
        res.end(body);
      });
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    const targetPort = (target.address() as net.AddressInfo).port;
    const agent = new http.Agent({ keepAlive: true });
    try {
      for (let i = 0; i < 2; i++) {
        const result = await new Promise<{ body: string; headers: http.IncomingHttpHeaders }>(
          (resolve, reject) => {
            const req = http.request(
              {
                host: '127.0.0.1',
                port: proxy.port,
                agent,
                method: 'POST',
                path: `http://target.test:${targetPort}/`,
                headers: {
                  Host: 'wrong.test',
                  Connection: 'keep-alive, X-Request-Hop',
                  'X-Request-Hop': 'remove-me',
                  TE: 'trailers',
                },
              },
              res => {
                let body = '';
                res.on('data', chunk => (body += chunk));
                res.on('error', reject);
                res.on('end', () => {
                  resolve({ body, headers: res.headers });
                });
              }
            );
            req.on('error', reject);
            req.write('chunk-');
            req.end(String(i));
          }
        );
        expect(result.body).toBe(`response-chunk-${i}`);
        expect(result.headers['x-response-hop']).toBeUndefined();
        expect(result.headers['set-cookie']).toEqual(['a=1', 'b=2']);
      }
      expect(received.map(({ body }) => body)).toEqual(['chunk-0', 'chunk-1']);
      for (const { headers } of received) {
        expect(headers.host).toBe(`target.test:${targetPort}`);
        expect(headers['x-request-hop']).toBeUndefined();
        expect(headers.te).toBeUndefined();
      }
    } finally {
      agent.destroy();
      target.closeAllConnections();
      await new Promise<void>(resolve =>
        target.close(() => {
          resolve();
        })
      );
    }
  });

  it.each([
    ['GET', 'Transfer-Encoding: chunked\r\nConnection: close', '4\r\ntest\r\n0\r\n\r\n'],
    ['DELETE', 'Transfer-Encoding: chunked\r\nConnection: close', '4\r\ntest\r\n0\r\n\r\n'],
    ['GET', 'Content-Length: 4\r\nConnection: close, Content-Length', 'test'],
  ])('preserves a raw %s body after rebuilding its framing (%s)', async (method, framing, body) => {
    const received: { body: string; headers: http.IncomingHttpHeaders }[] = [];
    const target = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        received.push({ body, headers: req.headers });
        res.end(`received:${body}`);
      });
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    try {
      const targetPort = (target.address() as net.AddressInfo).port;
      const response = await rawRequestAsync(
        `${method} http://target.test:${targetPort}/ HTTP/1.1\r\nHost: target.test\r\n${framing}\r\n\r\n${body}`
      );
      expect(response).toContain('HTTP/1.1 200');
      expect(response).toContain('received:test');
      expect(received).toHaveLength(1);
      expect(received[0].body).toBe('test');
      expect(received[0].headers['transfer-encoding']).toBe('chunked');
    } finally {
      target.closeAllConnections();
      await new Promise<void>(resolve => {
        target.close(() => {
          resolve();
        });
      });
    }
  });

  it('rejects transfer-coding chains it cannot decode without connecting upstream', async () => {
    const connection = jest.fn();
    targetHttpServer.on('connection', connection);
    try {
      const response = await rawRequestAsync(
        `GET http://target.test:${targetHttpPort}/ HTTP/1.1\r\nHost: target.test\r\nTransfer-Encoding: gzip, chunked\r\nConnection: close\r\n\r\n4\r\ntest\r\n0\r\n\r\n`
      );
      expect(response).toContain('HTTP/1.1 501');
      expect(connection).not.toHaveBeenCalled();
    } finally {
      targetHttpServer.removeListener('connection', connection);
    }
  });

  it('rejects upstream transfer-coding chains instead of forwarding undecoded bytes', async () => {
    const target = net.createServer(socket => {
      socket.once('data', () => {
        socket.end(
          'HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n4\r\ntest\r\n0\r\n\r\n'
        );
      });
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    try {
      const targetPort = (target.address() as net.AddressInfo).port;
      const response = await rawRequestAsync(
        `GET http://target.test:${targetPort}/ HTTP/1.1\r\nHost: target.test\r\nConnection: close\r\n\r\n`
      );
      expect(response).toContain('HTTP/1.1 502');
      expect(response).not.toContain('test');
    } finally {
      await new Promise<void>(resolve => {
        target.close(() => {
          resolve();
        });
      });
    }
  });

  it('closes a truncated upstream response and releases its operation', async () => {
    const target = net.createServer(socket => {
      socket.once('data', () =>
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial')
      );
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    try {
      const targetPort = (target.address() as net.AddressInfo).port;
      const response = await rawRequestAsync(
        `GET http://target.test:${targetPort}/ HTTP/1.1\r\nHost: target.test\r\nConnection: close\r\n\r\n`
      );
      expect(response).toContain('Content-Length: 100');
      expect(response).toContain('partial');
      await waitForAsync(() => proxy.getStats().active === 0);
    } finally {
      await new Promise<void>(resolve =>
        target.close(() => {
          resolve();
        })
      );
    }
  });

  it('destroys an in-flight upstream response when the downstream client disconnects', async () => {
    let upstreamClosed = false;
    const target = http.createServer((req, res) => {
      req.socket.once('close', () => (upstreamClosed = true));
      res.writeHead(200);
      res.write('partial');
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    const targetPort = (target.address() as net.AddressInfo).port;
    const client = net.connect(proxy.port, '127.0.0.1');
    try {
      const reply = once(client, 'data');
      client.write(`GET http://target.test:${targetPort}/ HTTP/1.1\r\nHost: target.test\r\n\r\n`);
      await reply;
      client.destroy();
      await waitForAsync(() => upstreamClosed && proxy.getStats().active === 0);
    } finally {
      client.destroy();
      target.closeAllConnections();
      await new Promise<void>(resolve =>
        target.close(() => {
          resolve();
        })
      );
    }
  });

  it('closes promptly while DNS is pending and does not connect after the late answer', async () => {
    let resolveDns!: (addresses: string[]) => void;
    const deferredProxy = await startLocalEgressProxyServerAsync({
      port: 0,
      resolveTargetAsync: () => new Promise(resolve => (resolveDns = resolve)),
    });
    const client = net.connect(deferredProxy.port, '127.0.0.1');
    client.write(`CONNECT target.test:${targetEchoPort} HTTP/1.1\r\nHost: target.test\r\n\r\n`);
    await waitForAsync(() => resolveDns !== undefined);
    const closed = once(client, 'close');
    await deferredProxy.closeAsync();
    await closed;
    expect(deferredProxy.getStats().active).toBe(0);
    resolveDns(['127.0.0.1']);
    await new Promise(resolve => setImmediate(resolve));
    expect(deferredProxy.getStats().active).toBe(0);
  });

  it('filters both upgrade handshakes and closes upgraded sockets during shutdown', async () => {
    let seenHeaders: http.IncomingHttpHeaders | undefined;
    const target = http.createServer();
    target.on('upgrade', (req, socket) => {
      seenHeaders = req.headers;
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade, X-Response-Hop\r\nUpgrade: websocket\r\nX-Response-Hop: remove-me\r\n\r\n'
      );
      socket.pipe(socket);
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    const targetPort = (target.address() as net.AddressInfo).port;
    const tunnelProxy = await startLocalEgressProxyServerAsync({
      port: 0,
      resolveTargetAsync: async () => ['127.0.0.1'],
    });
    const client = net.connect(tunnelProxy.port, '127.0.0.1');
    try {
      const reply = once(client, 'data');
      client.write(
        `GET http://target.test:${targetPort}/ HTTP/1.1\r\nHost: wrong.test\r\nConnection: Upgrade, X-Request-Hop\r\nUpgrade: websocket\r\nX-Request-Hop: remove-me\r\n\r\n`
      );
      const [handshake] = await reply;
      expect(handshake.toString()).toContain('101 Switching Protocols');
      expect(handshake.toString()).not.toContain('X-Response-Hop');
      expect(seenHeaders?.host).toBe(`target.test:${targetPort}`);
      expect(seenHeaders?.['x-request-hop']).toBeUndefined();
      const echo = once(client, 'data');
      client.write('ping');
      expect((await echo)[0].toString()).toBe('ping');
      const closed = once(client, 'close');
      await tunnelProxy.closeAsync();
      await closed;
      expect(tunnelProxy.getStats().active).toBe(0);
    } finally {
      client.destroy();
      await tunnelProxy.closeAsync();
      await new Promise<void>(resolve =>
        target.close(() => {
          resolve();
        })
      );
    }
  });
});

describe(runLocalEgressAsync, () => {
  afterEach(() => {
    jest.mocked(spawnAsync).mockReset();
    jest.mocked(fs.pathExists).mockReset();
  });
  it('does not spawn a child when interrupted during the binary cache lookup', async () => {
    let completeLookup!: (exists: boolean) => void;
    const exists = jest
      .mocked(fs.pathExists)
      .mockImplementation(() => new Promise<boolean>(resolve => (completeLookup = resolve)));
    const controller = new AbortController();
    try {
      const running = runLocalEgressAsync({
        url: 'https://example.test',
        auth: 'pw',
        fingerprint: 'fp',
        port: 8899,
        signal: controller.signal,
      });
      controller.abort();
      completeLookup(true);
      await running;
      expect(spawnAsync).not.toHaveBeenCalled();
    } finally {
      exists.mockReset();
    }
  });

  it('uses distinct ephemeral local ports and stops both proxies and children on abort', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    const children: ChildProcess[] = [];
    jest.mocked(spawnAsync).mockImplementation(() => {
      const child = new ChildProcess();
      children.push(child);
      const promise = new Promise<never>((_resolve, reject) => {
        child.kill = jest.fn(signal => {
          Object.defineProperty(child, 'signalCode', { value: signal, configurable: true });
          reject(new Error('terminated'));
          return true;
        });
      });
      return Object.assign(promise, { child });
    });
    const controllers = [new AbortController(), new AbortController()];
    const running = controllers.map(controller =>
      runLocalEgressAsync({
        url: 'https://example.test',
        auth: 'pw',
        fingerprint: 'fp',
        port: 8899,
        signal: controller.signal,
      })
    );
    try {
      await waitForAsync(() => children.length === 2);
      const localPorts = jest.mocked(spawnAsync).mock.calls.map(([, args, options]) => {
        expect(options).toMatchObject({ ignoreStdio: true, env: { AUTH: 'pw' } });
        const remote = args?.[args.length - 1] ?? '';
        expect(remote).toMatch(/^R:127\.0\.0\.1:8899:127\.0\.0\.1:\d+$/);
        return Number(remote.split(':').at(-1));
      });
      expect(new Set(localPorts).size).toBe(2);
      expect(localPorts.every(port => port > 0)).toBe(true);
      controllers.forEach(controller => {
        controller.abort();
      });
      await Promise.all(running);
      for (const child of children) {
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      }
      for (const port of localPorts) {
        const probe = net.connect(port, '127.0.0.1');
        const [error] = await once(probe, 'error');
        expect(error.code).toBe('ECONNREFUSED');
        probe.destroy();
      }
    } finally {
      controllers.forEach(controller => {
        controller.abort();
      });
      await Promise.all(running);
    }
  });
});
