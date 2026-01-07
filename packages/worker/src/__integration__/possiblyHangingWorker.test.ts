import { hostname } from 'os';
import { setTimeout as setTimeoutAsync } from 'timers/promises';
import WebSocket from 'ws';

import { WsHelper, unreachableCode } from './utils';
import { createTestAndroidJob } from './utils/jobs';
import logger from '../logger';
import BuildService from '../service';
import { cleanUpWorkingdir, prepareWorkingdir } from '../workingdir';
import startWsServer from '../ws';

const buildId = 'f38532aa-81a8-4db7-915f-6e7afe46e22f';

const MAX_BUILD_TIME_MS = 60 * 1000; // 1 min
jest.setTimeout(MAX_BUILD_TIME_MS);

// Mock @expo/build-tools at the library boundary
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

jest.mock('../upload');
jest.mock('../config', () => {
  const config = jest.requireActual('../config').default;
  return {
    ...config,
    buildId: 'f38532aa-81a8-4db7-915f-6e7afe46e22f',
  };
});

let spyReportHangingWorker: jest.SpyInstance;
let partialMockService: BuildService;
jest.mock('../service', () => {
  return function () {
    const BuildService = new (jest.requireActual('../service').default)();
    BuildService.getHangingWorkerCheckTimeoutMs = jest.fn(() => 1000 * 5); // wait for 5 seconds in test instead of 5 minutes
    spyReportHangingWorker = jest.spyOn(BuildService, 'reportHangingWorker');
    partialMockService = BuildService;
    return BuildService;
  };
});

function createDispatchMessage(): string {
  return JSON.stringify({
    type: 'dispatch',
    buildId,
    job: createTestAndroidJob(),
    initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
    metadata: {
      trackingContext: {},
    },
  });
}

async function setUpTestAsync(
  port: number,
  onMessage: (cb: (message: any) => void) => void
): Promise<[WebSocket, WsHelper, NodeJS.Timeout]> {
  const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
  const helper = new WsHelper(ws);
  const openPromise = helper.onOpen();
  helper.onMessage(onMessage);
  await openPromise;
  const messageTimeout = setTimeout(() => {
    unreachableCode('build timeout');
  }, MAX_BUILD_TIME_MS);
  return [ws, helper, messageTimeout];
}

describe('sending sentry report on hanging worker', () => {
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
    jest.resetAllMocks();
  });

  afterAll(async () => {
    await cleanUpWorkingdir();
  });

  // Helper to create fresh promise and message handler for each test
  function createSuccessHandler(): {
    successPromise: Promise<void>;
    onMessage: jest.Mock;
  } {
    let successPromiseResolve: () => void;
    const successPromise = new Promise<void>(res => {
      successPromiseResolve = res;
    });
    const onMessage = jest.fn((message: any) => {
      logger.debug('message received');
      try {
        expect(message).toBeTruthy();
        expect(message.type).toBe('success');
      } finally {
        successPromiseResolve();
      }
    });
    return { successPromise, onMessage };
  }

  describe('build successfully and send buildSuccess message', () => {
    describe('close message received from launcher', () => {
      it('should terminate worker without notifying sentry', async () => {
        const { successPromise, onMessage } = createSuccessHandler();
        const [ws, helper, messageTimeout] = await setUpTestAsync(port, onMessage);
        ws.send(createDispatchMessage());
        await successPromise;
        clearTimeout(messageTimeout);

        const closePromise = helper.onClose();
        ws.send(JSON.stringify({ type: 'close' }));
        await closePromise;

        await setTimeoutAsync(10 * 1000);
        expect(spyReportHangingWorker).not.toHaveBeenCalled();
      });
    });

    describe('close message received from launcher, but something went wrong and shouldCloseWorker is not true', () => {
      it('should log message and notify sentry about possibly hanging', async () => {
        const { successPromise, onMessage } = createSuccessHandler();
        const [ws, helper, messageTimeout] = await setUpTestAsync(port, onMessage);
        ws.send(createDispatchMessage());
        await successPromise;
        clearTimeout(messageTimeout);

        const actualCloseWorker = partialMockService.closeWorker;
        partialMockService.closeWorker = jest.fn(() => {});
        ws.send(JSON.stringify({ type: 'close' }));

        await setTimeoutAsync(10 * 1000);
        expect(spyReportHangingWorker).toHaveBeenCalled();

        partialMockService.closeWorker = actualCloseWorker;
        const closePromise = helper.onClose();
        ws.send(JSON.stringify({ type: 'close' }));
        await closePromise;
      });
    });

    describe('no close message received from launcher in specified time', () => {
      it('should log message and notify sentry about possibly hanging', async () => {
        const { successPromise, onMessage } = createSuccessHandler();
        const [ws, helper, messageTimeout] = await setUpTestAsync(port, onMessage);
        ws.send(createDispatchMessage());
        await successPromise;
        clearTimeout(messageTimeout);

        await setTimeoutAsync(10 * 1000);
        expect(spyReportHangingWorker).toHaveBeenCalled();

        const closePromise = helper.onClose();
        ws.send(JSON.stringify({ type: 'close' }));
        await closePromise;
      });
    });
  });
});
