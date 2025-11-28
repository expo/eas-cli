import path from 'path';
import { hostname } from 'os';

import { Artifacts } from '@expo/build-tools';
import { promise } from '@expo/turtle-common';
import { jobs } from '@expo/turtle-test-utils';
import fs from 'fs-extra';
import WebSocket from 'ws';

import config from '../config';
import logger from '../logger';
import { cleanUpWorkingdir, prepareWorkingdir } from '../workingdir';
import startWsServer from '../ws';
import { build } from '../build';

import { WsHelper, unreachableCode } from './utils';

const buildId = 'e9b99e52-fb74-4927-be63-33d7447ddfd4';

jest.setTimeout(30 * 1000);
jest.mock('../build', () => {
  return {
    ...jest.requireActual('../build'),
    build: jest.fn(async (): Promise<Artifacts> => {
      logger.debug('mocked build function');
      await promise.sleep(1000);

      const filename = path.join(config.workingdir, 'build', 'test.json');
      await fs.close(await fs.open(filename, 'w'));
      return {
        APPLICATION_ARCHIVE: `application-${buildId}`,
      };
    }),
  };
});
jest.mock('../service', () => {
  return function () {
    const BuildService = new (jest.requireActual('../service').default)();
    BuildService.checkForHangingWorker = jest.fn(async () => {});
    return BuildService;
  };
});
jest.mock('../config', () => {
  const config = jest.requireActual('../config').default;
  return {
    ...config,
    buildId: 'e9b99e52-fb74-4927-be63-33d7447ddfd4',
  };
});
jest.mock('../upload', () => {
  return {
    ...jest.requireActual('../upload'),
    uploadApplicationArchiveAsync: async () => {
      return `application-${buildId}`;
    },
  };
});

describe('State sync mechanism', () => {
  let port: number;
  let server: WebSocket.Server;
  let messageTimeout: NodeJS.Timeout;

  beforeEach(async () => {
    await prepareWorkingdir();
    port = Math.floor(Math.random() * 10000 + 10000);
    server = startWsServer(port);
    logger.debug(`Listening on port ${port}`);
  });

  afterEach(async () => {
    await new Promise((res) => {
      server.close(res);
    });
  });

  afterAll(async () => {
    await cleanUpWorkingdir();
  });

  describe('query new worker', () => {
    it("should return 'new' state", async () => {
      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);
      let stateResponsePromiseResolve: () => void;
      const stateResponsePromise = new Promise<void>((res) => {
        stateResponsePromiseResolve = res;
      });
      const onMessage = jest.fn((message: any) => {
        logger.debug('message received');
        clearTimeout(messageTimeout);
        try {
          expect(message).toBeTruthy();
          expect(message.type).toBe('state-response');
          expect(message.status).toBe('new');
        } catch (err) {
          throw err;
        } finally {
          stateResponsePromiseResolve();
        }
      });
      const openPromise = helper.onOpen();
      helper.onMessage(onMessage);

      await openPromise;
      messageTimeout = setTimeout(() => {
        unreachableCode('state-response timeout');
      }, 3000);
      ws.send(JSON.stringify({ type: 'state-query', buildId }));

      await stateResponsePromise;

      expect(helper.onErrorCb).not.toHaveBeenCalled();
      expect(helper.onOpenCb).toHaveBeenCalled();
      expect(helper.onMessageCb).toHaveBeenCalled();
      expect(helper.onCloseCb).not.toHaveBeenCalled();
      ws.close();
      clearTimeout(messageTimeout);
    });
  });

  describe('query worker after dispatch', () => {
    it("should return 'in-progress' state", async () => {
      const dispatchWS = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const dispatchHelper = new WsHelper(dispatchWS);
      await dispatchHelper.onOpen();
      dispatchWS.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: jobs.createTestAndroidJob(),
          initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
          metadata: {
            trackingContext: {},
          },
        })
      );
      dispatchWS.close();
      await dispatchHelper.onClose();

      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);

      let stateResponsePromiseResolve: () => void;
      const stateResponsePromise = new Promise<void>((res) => {
        stateResponsePromiseResolve = res;
      });
      const onMessage = jest.fn((message: any) => {
        logger.debug('message received');
        clearTimeout(messageTimeout);
        try {
          expect(message).toBeTruthy();
          expect(message.type).toBe('state-response');
          expect(message.status).toBe('in-progress');
        } catch (err) {
          throw err;
        } finally {
          stateResponsePromiseResolve();
        }
      });
      const openPromise = helper.onOpen();
      helper.onMessage(onMessage);

      await openPromise;
      messageTimeout = setTimeout(() => {
        unreachableCode('state-response timeout');
      }, 3000);
      ws.send(
        JSON.stringify({ type: 'state-query', buildId: 'e9b99e52-fb74-4927-be63-33d7447ddfd4' })
      );
      logger.debug('sent state-query');

      await stateResponsePromise;

      expect(helper.onErrorCb).not.toHaveBeenCalled();
      expect(helper.onOpenCb).toHaveBeenCalled();
      expect(helper.onMessageCb).toHaveBeenCalled();
      expect(helper.onCloseCb).not.toHaveBeenCalled();
      ws.close();
      clearTimeout(messageTimeout);
    });
  });

  describe('query worker after build', () => {
    it("should return 'success' state", async () => {
      const dispatchWS = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const dispatchHelper = new WsHelper(dispatchWS);
      await dispatchHelper.onOpen();
      dispatchWS.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: jobs.createTestAndroidJob(),
          initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
          metadata: {
            trackingContext: {},
          },
        })
      );
      dispatchWS.close();
      await dispatchHelper.onClose();

      await promise.sleep(2000);

      logger.debug('Establising new connection to worker');
      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);

      let stateResponsePromiseResolve: () => void;
      const stateResponsePromise = new Promise<void>((res) => {
        stateResponsePromiseResolve = res;
      });
      const onMessage = jest.fn((message: any) => {
        logger.debug('message received');
        clearTimeout(messageTimeout);
        try {
          expect(message).toBeTruthy();
          expect(message.applicationArchiveName).toBe(`application-${buildId}`);
          expect(message.type).toBe('state-response');
          expect(message.status).toBe('success');
        } catch (err) {
          throw err;
        } finally {
          stateResponsePromiseResolve();
        }
      });
      const openPromise = helper.onOpen();
      helper.onMessage(onMessage);

      await openPromise;
      messageTimeout = setTimeout(() => {
        unreachableCode('state-response timeout');
      }, 3000);

      ws.send(JSON.stringify({ type: 'state-query', buildId }));
      logger.debug('sent state-query');

      await stateResponsePromise;

      expect(helper.onErrorCb).not.toHaveBeenCalled();
      expect(helper.onOpenCb).toHaveBeenCalled();
      expect(helper.onMessageCb).toHaveBeenCalled();
      expect(helper.onCloseCb).not.toHaveBeenCalled();
      ws.close();
      clearTimeout(messageTimeout);
    });
  });

  describe('query worker after error', () => {
    it("should return 'error' state with artifacts from error", async () => {
      jest.mocked(build).mockImplementation(async () => {
        const error = new Error();
        (error as any).artifacts = {
          APPLICATION_ARCHIVE: `application-${buildId}`,
        };
        throw error;
      });
      const dispatchWS = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const dispatchHelper = new WsHelper(dispatchWS);
      await dispatchHelper.onOpen();
      dispatchWS.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: jobs.createTestAndroidJob(),
          initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
          metadata: {
            trackingContext: {},
          },
        })
      );
      dispatchWS.close();
      await dispatchHelper.onClose();

      logger.debug('Establising new connection to worker');
      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);

      let stateResponsePromiseResolve: () => void;
      const stateResponsePromise = new Promise<void>((res) => {
        stateResponsePromiseResolve = res;
      });
      const onMessage = jest.fn((message: any) => {
        logger.debug('message received');
        clearTimeout(messageTimeout);
        try {
          expect(message).toBeTruthy();
          expect(message.applicationArchiveName).toBe(`application-${buildId}`);
          expect(message.type).toBe('state-response');
          expect(message.status).toBe('error');
        } catch (err) {
          throw err;
        } finally {
          stateResponsePromiseResolve();
        }
      });
      const openPromise = helper.onOpen();
      helper.onMessage(onMessage);

      await openPromise;
      messageTimeout = setTimeout(() => {
        unreachableCode('state-response timeout');
      }, 3000);

      ws.send(JSON.stringify({ type: 'state-query', buildId }));
      logger.debug('sent state-query');

      await stateResponsePromise;

      expect(helper.onErrorCb).not.toHaveBeenCalled();
      expect(helper.onOpenCb).toHaveBeenCalled();
      expect(helper.onMessageCb).toHaveBeenCalled();
      expect(helper.onCloseCb).not.toHaveBeenCalled();
      ws.close();
      clearTimeout(messageTimeout);
    });
  });
});
