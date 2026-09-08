import {
  SandboxDaemonCommands,
  type SandboxDaemonMethod,
  SandboxDaemonRequestZ,
  type SandboxDaemonResponse,
  SystemError,
} from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import WebSocket from 'ws';

import {
  type SandboxDaemonCommandImplementations,
  createSandboxDaemonCommandImplementations,
} from './sandboxCommandImplementations';

export interface SandboxDaemonOptions {
  credential: string;
  serverUrl: string;
  reconnectDelayMs: number;
  logger: bunyan;
  signal?: AbortSignal;
  workingDirectory: string;
}

export interface SandboxDaemon {
  ready: Promise<void>;
  stopAsync(): Promise<void>;
}

export async function startSandboxDaemonAsync(
  options: SandboxDaemonOptions
): Promise<SandboxDaemon> {
  options.signal?.throwIfAborted();
  let socket: WebSocket | undefined;
  const abortController = new AbortController();
  let hasConnected = false;
  let resolveConnected!: () => void;
  let rejectConnected!: (error: Error) => void;
  const { commandImplementations, stopAsync: stopCommandImplementationsAsync } =
    createSandboxDaemonCommandImplementations(options.workingDirectory);
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });
  const stop = (): void => {
    abortController.abort();
    socket?.close(1000, 'sandbox stopped');
  };
  options.signal?.addEventListener('abort', stop, { once: true });

  const connectionLoop = (async () => {
    while (!abortController.signal.aborted) {
      try {
        const connectedSocket = new WebSocket(new URL('/sandbox/connect', options.serverUrl), {
          handshakeTimeout: 10_000,
          headers: { Authorization: `Bearer ${options.credential}` },
        });
        socket = connectedSocket;
        await waitForOpen(connectedSocket);
        options.logger.info('Sandbox MCP server connected.');
        connectedSocket.on('message', message => {
          void handleMessageAsync(commandImplementations, message.toString(), response => {
            if (connectedSocket.readyState === WebSocket.OPEN) {
              connectedSocket.send(JSON.stringify(response));
            }
          });
        });
        hasConnected = true;
        resolveConnected();
        await waitForClose(connectedSocket);
      } catch (error: any) {
        if (!hasConnected) {
          const message = `Sandbox MCP server connection failed: ${error?.message ?? 'unknown error'}`;
          if (!abortController.signal.aborted) {
            options.logger.error({ err: error }, message);
          }
          rejectConnected(new SystemError(message, { cause: error }));
          return;
        }
        if (!abortController.signal.aborted) {
          options.logger.warn(
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
      options.signal?.removeEventListener('abort', stop);
      stop();
      await stopCommandImplementationsAsync();
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
  return new Promise((resolve, reject) => {
    socket.once('close', resolve);
    socket.once('error', reject);
  });
}

type JsonRpcResponse =
  | SandboxDaemonResponse
  | {
      jsonrpc: '2.0';
      id: string | null;
      error: { code: number; message: string; data?: unknown };
    };

async function handleMessageAsync(
  commandImplementations: SandboxDaemonCommandImplementations,
  message: string,
  send: (response: JsonRpcResponse) => void
): Promise<void> {
  let rawRequest: unknown;
  try {
    rawRequest = JSON.parse(message);
  } catch {
    sendError(send, null, -32700, 'Parse error');
    return;
  }

  const request = SandboxDaemonRequestZ.safeParse(rawRequest);
  if (!request.success) {
    sendError(send, null, -32600, 'Invalid request', request.error.flatten());
    return;
  }

  const { id, method, params } = request.data;
  if (!Object.hasOwn(SandboxDaemonCommands, method)) {
    sendError(send, id, -32601, 'Method not found');
    return;
  }
  const commandMethod = method as SandboxDaemonMethod;

  const parsedParams = SandboxDaemonCommands[commandMethod].params.safeParse(params);
  if (!parsedParams.success) {
    sendError(send, id, -32602, 'Invalid params', parsedParams.error.flatten());
    return;
  }
  try {
    const result = await commandImplementations[commandMethod](parsedParams.data as never);
    send({
      jsonrpc: '2.0',
      id,
      result: SandboxDaemonCommands[commandMethod].result.parse(result),
    });
  } catch (error) {
    sendError(send, id, -32603, error instanceof Error ? error.message : 'Internal error');
  }
}

function sendError(
  send: (response: JsonRpcResponse) => void,
  id: string | null,
  code: number,
  message: string,
  data?: unknown
): void {
  send({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}
