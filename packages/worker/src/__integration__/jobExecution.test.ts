import { hostname } from 'os';
import WebSocket from 'ws';

import { WsHelper, unreachableCode } from './utils';
import { createTestAndroidJob, createTestIosJob } from './utils/jobs';
import logger from '../logger';
import { cleanUpWorkingdir, prepareWorkingdir } from '../workingdir';
import startWsServer from '../ws';

const buildId = 'e9b99e52-fb74-4927-be63-33d7447ddfd4';

jest.setTimeout(30 * 1000);

// Mock @expo/build-tools at the library boundary - worker's build.ts runs for real
jest.mock('@expo/build-tools', () => {
  const actual = jest.requireActual('@expo/build-tools');
  return {
    ...actual,
    Builders: {
      androidBuilder: jest.fn(async () => ({
        APPLICATION_ARCHIVE: 'test-android.aab',
      })),
      iosBuilder: jest.fn(async () => ({
        APPLICATION_ARCHIVE: 'test-ios.ipa',
      })),
    },
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
    uploadApplicationArchiveAsync: jest.fn(async () => 'uploaded-archive'),
  };
});

describe('Job execution', () => {
  let port: number;
  let server: WebSocket.Server;

  beforeEach(async () => {
    await prepareWorkingdir();
    port = Math.floor(Math.random() * 10000 + 10000);
    server = startWsServer(port);
    logger.debug(`Listening on port ${port}`);
  });

  afterEach(async () => {
    await new Promise(res => {
      server.close(res);
    });
  });

  afterAll(async () => {
    await cleanUpWorkingdir();
  });

  describe('Android build', () => {
    it('should execute build and return success', async () => {
      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);

      let successPromiseResolve: () => void;
      const successPromise = new Promise<void>(res => {
        successPromiseResolve = res;
      });

      const onMessage = jest.fn((message: any) => {
        logger.debug('message received');
        try {
          expect(message).toBeTruthy();
          expect(message.type).toBe('success');
          expect(message.applicationArchiveName).toBeTruthy();
        } finally {
          successPromiseResolve();
        }
      });

      const openPromise = helper.onOpen();
      helper.onMessage(onMessage);

      await openPromise;
      const messageTimeout = setTimeout(() => {
        unreachableCode('build timeout');
      }, 20000);

      ws.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: createTestAndroidJob(),
          initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
          metadata: {
            trackingContext: {},
            buildProfile: 'production',
          },
        })
      );

      await successPromise;
      clearTimeout(messageTimeout);

      const closePromise = helper.onClose();
      ws.send(JSON.stringify({ type: 'close' }));
      await closePromise;

      expect(helper.onErrorCb).not.toHaveBeenCalled();
      expect(helper.onOpenCb).toHaveBeenCalled();
      expect(helper.onMessageCb).toHaveBeenCalled();
      expect(helper.onCloseCb).toHaveBeenCalled();
    });
  });

  describe('iOS build', () => {
    it('should execute build and return success', async () => {
      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);

      let successPromiseResolve: () => void;
      const successPromise = new Promise<void>(res => {
        successPromiseResolve = res;
      });

      const onMessage = jest.fn((message: any) => {
        logger.debug('message received');
        try {
          expect(message).toBeTruthy();
          expect(message.type).toBe('success');
          expect(message.applicationArchiveName).toBeTruthy();
        } finally {
          successPromiseResolve();
        }
      });

      const openPromise = helper.onOpen();
      helper.onMessage(onMessage);

      await openPromise;
      const messageTimeout = setTimeout(() => {
        unreachableCode('build timeout');
      }, 20000);

      ws.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: createTestIosJob(),
          initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
          metadata: {
            trackingContext: {},
            buildProfile: 'production',
          },
        })
      );

      await successPromise;
      clearTimeout(messageTimeout);

      const closePromise = helper.onClose();
      ws.send(JSON.stringify({ type: 'close' }));
      await closePromise;

      expect(helper.onErrorCb).not.toHaveBeenCalled();
      expect(helper.onOpenCb).toHaveBeenCalled();
      expect(helper.onMessageCb).toHaveBeenCalled();
      expect(helper.onCloseCb).toHaveBeenCalled();
    });
  });

  describe('graceful shutdown', () => {
    it('should handle close message after build completes', async () => {
      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);

      let successPromiseResolve: () => void;
      const successPromise = new Promise<void>(res => {
        successPromiseResolve = res;
      });

      const onMessage = jest.fn((message: any) => {
        if (message.type === 'success') {
          successPromiseResolve();
        }
      });

      const openPromise = helper.onOpen();
      helper.onMessage(onMessage);

      await openPromise;

      ws.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: createTestAndroidJob(),
          initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
          metadata: {
            trackingContext: {},
          },
        })
      );

      await successPromise;

      const closePromise = helper.onClose();
      ws.send(JSON.stringify({ type: 'close' }));
      await closePromise;

      expect(helper.onCloseCb).toHaveBeenCalled();
    });
  });
});

