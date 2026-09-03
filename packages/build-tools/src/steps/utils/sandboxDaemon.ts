import Log from '@expo/logger';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import WebSocket from 'ws';

export interface SandboxDaemonOptions {
  credential: string;
  serverUrl: string;
  reconnectDelayMs: number;
}

export interface SandboxDaemon {
  ready: Promise<void>;
  stopAsync(): Promise<void>;
}

export async function startSandboxDaemonAsync(
  options: SandboxDaemonOptions
): Promise<SandboxDaemon> {
  const connectionUrl = new URL('/sandbox/connect', options.serverUrl);
  let socket: WebSocket | undefined;
  const abortController = new AbortController();
  let hasConnected = false;
  let resolveConnected!: () => void;
  let rejectConnected!: (error: Error) => void;
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });

  const connectionLoop = (async () => {
    while (!abortController.signal.aborted) {
      socket = new WebSocket(connectionUrl, {
        headers: { Authorization: `Bearer ${options.credential}` },
      });
      try {
        await waitForOpen(socket);
        Log.info('Sandbox MCP server connected.');
        hasConnected = true;
        resolveConnected();
        await waitForClose(socket);
      } catch (error: any) {
        if (!hasConnected) {
          const message = `Sandbox MCP server connection failed: ${error?.message ?? 'unknown error'}`;
          if (!abortController.signal.aborted) {
            Log.error({ err: error }, message);
          }
          rejectConnected(new Error(message, { cause: error }));
          return;
        }
        if (!abortController.signal.aborted) {
          Log.warn(
            { err: error },
            `Sandbox MCP server connection failed: ${error?.message ?? 'unknown error'}`
          );
        }
      }
      if (!abortController.signal.aborted) {
        try {
          await setTimeoutAsync(options.reconnectDelayMs, undefined, {
            signal: abortController.signal,
          });
        } catch (error) {
          if (!abortController.signal.aborted) {
            throw error;
          }
        }
      }
    }
  })();

  return {
    ready: connected,
    async stopAsync(): Promise<void> {
      abortController.abort();
      socket?.close(1000, 'sandbox stopped');
      await connectionLoop;
    },
  };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('Sandbox MCP server closed before it connected.')));
  });
}

function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    socket.once('close', resolve);
    socket.once('error', resolve);
  });
}
