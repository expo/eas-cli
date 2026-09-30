import {
  type SandboxDaemonCommandResult,
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
  createSandboxCommandImplementations,
} from './sandboxCommandImplementations';

export interface SandboxDaemonOptions {
  credential: string;
  serverUrl: string;
  reconnectDelayMs: number;
  logger: bunyan;
  signal?: AbortSignal;
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
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
  const { commandImplementations, stoppedPromise: commandsStoppedPromise } =
    createSandboxCommandImplementations({
      workingDirectory: options.workingDirectory,
      env: options.env,
      signal: abortController.signal,
    });
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
        connectedSocket.on('message', async message => {
          try {
            const response = await handleMessageAsync(commandImplementations, message.toString());
            // MCP fails pending calls on disconnect. Responses belong to this socket only.
            if (connectedSocket.readyState !== WebSocket.OPEN) {
              options.logger.warn(
                'Sandbox command response was lost after disconnect. The command may have run and output may have been consumed.'
              );
              return;
            }
            await new Promise<void>((resolve, reject) => {
              connectedSocket.send(JSON.stringify(response), error => {
                if (error) {
                  reject(error);
                } else {
                  resolve();
                }
              });
            });
          } catch (error) {
            options.logger.warn({ err: error }, 'Could not send sandbox command response.');
          }
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
      await commandsStoppedPromise;
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

async function handleMessageAsync(
  commandImplementations: SandboxDaemonCommandImplementations,
  message: string
): Promise<SandboxDaemonResponse> {
  let rawRequest: unknown;
  try {
    rawRequest = JSON.parse(message);
  } catch {
    return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
  }

  const request = SandboxDaemonRequestZ.safeParse(rawRequest);
  if (!request.success) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  }

  const { id, method, params } = request.data;
  if (!Object.hasOwn(SandboxDaemonCommands, method)) {
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }
  const commandMethod = method as SandboxDaemonMethod;

  const parsedParams = SandboxDaemonCommands[commandMethod].params.safeParse(params);
  if (!parsedParams.success) {
    return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params' } };
  }
  try {
    return {
      jsonrpc: '2.0',
      id,
      result: await (
        commandImplementations[commandMethod] as (
          params: typeof parsedParams.data
        ) => Promise<SandboxDaemonCommandResult<typeof commandMethod>>
      )(parsedParams.data),
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
    };
  }
}
