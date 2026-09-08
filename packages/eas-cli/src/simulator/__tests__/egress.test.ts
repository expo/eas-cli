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
  startLocalEgressProxyServerAsync,
} from '../egress';

jest.mock('../../log');

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

  it('forwards plain HTTP requests with absolute URLs and keeps the Host header', async () => {
    const response = await rawRequestAsync(
      `GET http://target.test:${targetHttpPort}/path?q=1 HTTP/1.1\r\nHost: target.test:${targetHttpPort}\r\nProxy-Connection: keep-alive\r\nConnection: close\r\n\r\n`
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
});
