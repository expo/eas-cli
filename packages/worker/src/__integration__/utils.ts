import WebSocket from 'ws';
import { env } from '@expo/turtle-common';
import { Android } from '@expo/eas-build-job';

import logger from '../logger';

export function unreachableCode(msg: string): void {
  expect(msg).toBeFalsy();
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
    this.onMessageCb = jest.fn((raw) => {
      logger.debug({ raw }, 'ws message');
      const parsed = JSON.parse(raw);
      if (parsed.type !== 'build-phase-stats') {
        cb(parsed);
      }
    });
    this.ws.on('message', this.onMessageCb);
  }
}

export const ANDROID_CREDENTIALS: Android.BuildSecrets['buildCredentials'] = {
  keystore: {
    dataBase64: env('TURTLE_TEST_ANDROID_STORE_DATA'),
    keystorePassword: env('TURTLE_TEST_ANDROID_STORE_PASSWORD'),
    keyAlias: env('TURTLE_TEST_ANDROID_STORE_ALIAS'),
    keyPassword: env('TURTLE_TEST_ANDROID_STORE_ALIAS_PASSWORD'),
  },
};
