import Log from '@expo/logger';
import http from 'node:http';
import net, { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';

import { startSandboxDaemonAsync } from '../sandboxDaemon';

jest.unmock('@expo/logger');

describe(startSandboxDaemonAsync.name, () => {
  it('can stop while the initial connection is pending', async () => {
    const tcpServer = net.createServer();
    await new Promise<void>(resolve => tcpServer.listen(0, '127.0.0.1', resolve));
    const address = tcpServer.address() as AddressInfo;
    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 60_000,
      workingDirectory: process.cwd(),
    });
    const connectionError = daemon.ready.catch(error => error);

    await daemon.stopAsync();

    await expect(connectionError).resolves.toBeInstanceOf(Error);
    await new Promise<void>(resolve => tcpServer.close(() => resolve()));
  });

  it('fails when the initial connection cannot be opened', async () => {
    const errorLog = jest.spyOn(Log, 'error').mockImplementation(() => {});
    const httpServer = http.createServer();
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    await new Promise<void>(resolve => httpServer.close(() => resolve()));

    const daemon = await startSandboxDaemonAsync({
      credential: 'secret-token',
      serverUrl: `ws://127.0.0.1:${address.port}`,
      reconnectDelayMs: 60_000,
      workingDirectory: process.cwd(),
    });

    await expect(daemon.ready).rejects.toThrow('Sandbox MCP server connection failed');
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

  it('responds to ping messages', async () => {
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
      workingDirectory: process.cwd(),
    });
    const socket = await connection;
    await daemon.ready;
    const response = new Promise<string>(resolve =>
      socket.once('message', data => resolve(`${data}`))
    );

    socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'ping-1', method: 'ping' }));

    await expect(response).resolves.toBe(
      JSON.stringify({ jsonrpc: '2.0', id: 'ping-1', result: {} })
    );

    const commandResponse = new Promise<string>(resolve =>
      socket.once('message', data => resolve(`${data}`))
    );
    socket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'command-1',
        method: 'exec_command',
        params: { cmd: 'printf hello' },
      })
    );

    expect(JSON.parse(await commandResponse)).toMatchObject({
      jsonrpc: '2.0',
      id: 'command-1',
      result: { output: 'hello', exit_code: 0 },
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
