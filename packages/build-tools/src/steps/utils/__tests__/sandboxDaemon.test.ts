import { SystemError } from '@expo/eas-build-job';
import Log from '@expo/logger';
import http from 'node:http';
import net, { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';

import { startSandboxDaemonAsync } from '../sandboxDaemon';

jest.unmock('@expo/logger');
jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');

describe(startSandboxDaemonAsync.name, () => {
  const logger = Log.child({ buildStepId: 'sandbox-test' });
  it.each(['ftp://localhost', 'not a URL'])('reports invalid server URL %s', async serverUrl => {
    const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl,
      reconnectDelayMs: 10,
      logger,
      workingDirectory: process.cwd(),
    });
    try {
      await expect(daemon.ready).rejects.toBeInstanceOf(SystemError);
      expect(errorLog).toHaveBeenCalledWith(
        { err: expect.objectContaining({ message: expect.any(String) }) },
        expect.any(String)
      );
    } finally {
      await daemon.stopAsync();
      errorLog.mockRestore();
    }
  });

  it('logs errors after the connection opens', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>(resolve => server.once('listening', resolve));
    const connection = new Promise<WebSocket>(resolve => server.once('connection', resolve));
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      reconnectDelayMs: 60_000,
      logger,
      workingDirectory: process.cwd(),
    });
    try {
      const socket = await connection;
      await daemon.ready;
      // An invalid opcode makes the client emit a protocol error.
      const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
      (socket as any)._socket.write(Buffer.from([0x83, 0x00]));
      await closed;
      expect(warn).toHaveBeenCalledWith(
        { err: expect.objectContaining({ message: expect.stringContaining('invalid opcode') }) },
        expect.stringContaining('invalid opcode')
      );
    } finally {
      await daemon.stopAsync();
      await new Promise<void>(resolve => server.close(() => resolve()));
      warn.mockRestore();
    }
  });
  it('fails if the server does not complete the handshake', async () => {
    const sockets = new Set<net.Socket>();
    const tcpServer = net.createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => tcpServer.listen(0, '127.0.0.1', resolve));
    const address = tcpServer.address() as AddressInfo;
    const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 10,
      logger,
      workingDirectory: process.cwd(),
    });
    try {
      await expect(daemon.ready).rejects.toBeInstanceOf(SystemError);
      expect(errorLog).toHaveBeenCalledWith(
        { err: expect.objectContaining({ message: 'Opening handshake has timed out' }) },
        expect.stringContaining('Opening handshake has timed out')
      );
    } finally {
      await daemon.stopAsync();
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>(resolve => tcpServer.close(() => resolve()));
      errorLog.mockRestore();
    }
  }, 15_000);

  it.each(['stop', 'abort'])('can %s while the initial connection is pending', async action => {
    const controller = new AbortController();
    const tcpServer = net.createServer();
    await new Promise<void>(resolve => tcpServer.listen(0, '127.0.0.1', resolve));
    const address = tcpServer.address() as AddressInfo;
    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 60_000,
      logger,
      signal: controller.signal,
      workingDirectory: process.cwd(),
    });
    const connectionError = daemon.ready.catch(error => error);

    if (action === 'abort') {
      controller.abort();
    } else {
      await daemon.stopAsync();
    }

    await expect(connectionError).resolves.toBeInstanceOf(Error);
    await daemon.stopAsync();
    await new Promise<void>(resolve => tcpServer.close(() => resolve()));
  });

  it('fails when the initial connection cannot be opened', async () => {
    const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const httpServer = http.createServer();
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    await new Promise<void>(resolve => httpServer.close(() => resolve()));

    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 60_000,
      logger,
      workingDirectory: process.cwd(),
    });

    await expect(daemon.ready).rejects.toThrow('Sandbox MCP server connection failed');
    await expect(daemon.ready).rejects.toBeInstanceOf(SystemError);
    expect(errorLog).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: expect.stringContaining('ECONNREFUSED') }) },
      expect.stringContaining('ECONNREFUSED')
    );
    await daemon.stopAsync();
    errorLog.mockRestore();
  });

  it('connects with the credential and closes on stop', async () => {
    const httpServer = http.createServer();
    const mcpServer = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (request, socket, head) => {
      expect(request.url).toBe('/sandbox/connect');
      expect(request.headers.authorization).toBe('Bearer secret-token');
      mcpServer.handleUpgrade(request, socket, head, client =>
        mcpServer.emit('connection', client)
      );
    });
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    const connection = new Promise<WebSocket>(resolve => mcpServer.once('connection', resolve));

    const daemonPromise = startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 10,
      logger,
      workingDirectory: process.cwd(),
    });
    const socket = await connection;
    const daemon = await daemonPromise;
    await daemon.ready;
    const socketClosed = new Promise<void>(resolve => socket.once('close', () => resolve()));

    await daemon.stopAsync();
    await socketClosed;

    mcpServer.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  it('executes command messages', async () => {
    const httpServer = http.createServer();
    const mcpServer = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (request, socket, head) => {
      mcpServer.handleUpgrade(request, socket, head, client =>
        mcpServer.emit('connection', client)
      );
    });
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    const connection = new Promise<WebSocket>(resolve => mcpServer.once('connection', resolve));
    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 10,
      logger,
      workingDirectory: process.cwd(),
    });
    const socket = await connection;
    await daemon.ready;
    const commandResponse = new Promise<string>(resolve =>
      socket.once('message', data => resolve(`${data}`))
    );
    socket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'command-1',
        method: 'execCommand',
        params: { cmd: 'printf hello' },
      })
    );

    expect(JSON.parse(await commandResponse)).toMatchObject({
      jsonrpc: '2.0',
      id: 'command-1',
      result: { output: 'hello', exitCode: 0 },
    });
    await daemon.stopAsync();
    mcpServer.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  it('returns JSON-RPC errors for invalid messages', async () => {
    const httpServer = http.createServer();
    const mcpServer = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (request, socket, head) => {
      mcpServer.handleUpgrade(request, socket, head, client =>
        mcpServer.emit('connection', client)
      );
    });
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    const connection = new Promise<WebSocket>(resolve => mcpServer.once('connection', resolve));
    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 10,
      logger,
      workingDirectory: process.cwd(),
    });
    const socket = await connection;
    await daemon.ready;
    const sendAsync = async (message: string): Promise<unknown> => {
      const response = new Promise<string>(resolve =>
        socket.once('message', data => resolve(`${data}`))
      );
      socket.send(message);
      return JSON.parse(await response);
    };

    await expect(sendAsync('{')).resolves.toMatchObject({
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
    await expect(
      sendAsync(JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'unknown' }))
    ).resolves.toMatchObject({
      id: '1',
      error: { code: -32601, message: 'Method not found' },
    });
    await expect(
      sendAsync(JSON.stringify({ jsonrpc: '2.0', id: '2', method: 'execCommand', params: {} }))
    ).resolves.toMatchObject({
      id: '2',
      error: { code: -32602, message: 'Invalid params' },
    });

    await daemon.stopAsync();
    mcpServer.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  it('cancels the reconnect delay when stopped', async () => {
    const httpServer = http.createServer();
    const mcpServer = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (request, socket, head) => {
      mcpServer.handleUpgrade(request, socket, head, client =>
        mcpServer.emit('connection', client)
      );
    });
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    const connection = new Promise<WebSocket>(resolve => mcpServer.once('connection', resolve));
    const daemonPromise = startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 60_000,
      logger,
      workingDirectory: process.cwd(),
    });
    const socket = await connection;
    const daemon = await daemonPromise;
    await daemon.ready;
    const socketClosed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    socket.close();
    await socketClosed;
    await new Promise<void>(resolve => setImmediate(resolve));

    await daemon.stopAsync();

    mcpServer.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });
});
