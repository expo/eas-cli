import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';

import { startLocalEgressProxyServerAsync } from '../egress';

jest.mock('../../log');

async function connectAsync(port: number): Promise<net.Socket> {
  const socket = net.connect(port, '127.0.0.1');
  socket.on('error', () => {});
  await once(socket, 'connect');
  return socket;
}

async function waitForClosedAsync(socket: net.Socket): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!socket.destroyed) {
    if (Date.now() >= deadline) {
      throw new Error('The proxy did not reject the connection above its socket limit.');
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('local egress accepted connection limit', () => {
  it.each(['CONNECT', 'upgrade'])(
    'counts idle and %s connections, excludes upstream sockets, and releases capacity',
    async method => {
      const upstreamSockets = new Set<net.Socket>();
      const target = http.createServer((_req, res) => res.end('ok'));
      target.on('connection', socket => {
        upstreamSockets.add(socket);
        socket.once('close', () => upstreamSockets.delete(socket));
      });
      target.on('upgrade', (_req, socket) => {
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'
        );
        socket.pipe(socket);
      });
      await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
      const targetPort = (target.address() as net.AddressInfo).port;
      const proxy = await startLocalEgressProxyServerAsync({
        port: 0,
        resolveTargetAsync: async () => ['127.0.0.1'],
      });
      const clients: net.Socket[] = [];
      try {
        // Fill the production limit with 511 unparsed sockets and one active tunnel.
        clients.push(
          ...(await Promise.all(Array.from({ length: 511 }, () => connectAsync(proxy.port))))
        );
        const tunnel = await connectAsync(proxy.port);
        clients.push(tunnel);
        const reply = once(tunnel, 'data');
        const destination = `target.test:${targetPort}`;
        tunnel.write(
          method === 'CONNECT'
            ? `CONNECT ${destination} HTTP/1.1\r\nHost: ${destination}\r\n\r\n`
            : `GET http://${destination}/ HTTP/1.1\r\nHost: ${destination}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`
        );
        expect((await reply)[0].toString()).toContain(
          method === 'CONNECT' ? '200 Connection Established' : '101 Switching Protocols'
        );
        expect(proxy.getStats().active).toBe(1);

        const excess = await connectAsync(proxy.port);
        clients.push(excess);
        await waitForClosedAsync(excess);
        expect(proxy.getStats().refused).toBe(1);

        // A peer-acknowledged close frees a downstream slot even though the tunnel remains.
        const closed = once(clients[0], 'close');
        clients[0].end();
        await closed;
        const replacement = await connectAsync(proxy.port);
        clients.push(replacement);
        const response = once(replacement, 'data');
        replacement.write(
          `GET http://${destination}/ HTTP/1.1\r\nHost: ${destination}\r\nConnection: close\r\n\r\n`
        );
        expect((await response)[0].toString()).toContain('200 OK');
      } finally {
        for (const client of clients) {
          client.destroy();
        }
        await proxy.closeAsync();
        for (const socket of upstreamSockets) {
          socket.destroy();
        }
        await new Promise<void>(resolve =>
          target.close(() => {
            resolve();
          })
        );
      }
    }
  );
});
