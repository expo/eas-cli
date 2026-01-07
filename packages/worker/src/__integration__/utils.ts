import WebSocket from 'ws';

import logger from '../logger';

export function unreachableCode(msg: string): void {
  expect(msg).toBeFalsy();
}

/**
 * Properly close a WebSocket server by terminating all client connections first.
 * This prevents open handles that would cause Jest not to exit cleanly.
 */
export async function closeServerWithClients(server: WebSocket.Server): Promise<void> {
  // Terminate all connected clients first
  for (const client of server.clients) {
    client.terminate();
  }
  // Then close the server
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });
}

export class WsHelper {
  public ws: WebSocket;
  public onOpenCb?: () => void = jest.fn();
  public onCloseCb?: () => void = jest.fn();
  public onMessageCb?: (msg: any) => void = jest.fn();
  public onErrorCb = jest.fn();

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on('error', this.onErrorCb);
  }

  public onOpen(): Promise<void> {
    return new Promise((res, rej) => {
      const openTimeout = setTimeout(() => {
        rej(new Error('onOpen rejected'));
      }, 3000);
      this.onOpenCb = jest.fn(() => {
        logger.debug('ws open');
        res();
        clearTimeout(openTimeout);
      });
      this.ws.on('open', this.onOpenCb);
    });
  }

  public onClose(): Promise<void> {
    return new Promise((res, rej) => {
      const closeTimeout = setTimeout(() => {
        rej(new Error('onClose rejected'));
      }, 3000);
      this.onCloseCb = jest.fn(() => {
        logger.debug('ws close');
        res();
        clearTimeout(closeTimeout);
      });
      this.ws.on('close', this.onCloseCb);
    });
  }

  public onMessage(cb: (message: any) => void): void {
    this.onMessageCb = jest.fn(raw => {
      logger.debug({ raw }, 'ws message');
      const parsed = JSON.parse(raw);
      if (parsed.type !== 'build-phase-stats') {
        cb(parsed);
      }
    });
    this.ws.on('message', this.onMessageCb);
  }
}
