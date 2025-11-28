import { hostname } from 'os';

import { env, promise } from '@expo/turtle-common';
import WebSocket from 'ws';
import { ArchiveSourceType } from '@expo/eas-build-job';

import logger from '../logger';
import { cleanUpWorkingdir, prepareWorkingdir } from '../workingdir';
import startWsServer from '../ws';
import BuildService from '../service';

import { unreachableCode, WsHelper, ANDROID_CREDENTIALS } from './utils';

const buildId = 'f38532aa-81a8-4db7-915f-6e7afe46e22f';

const MAX_BUILD_TIME_MS = 60 * 1000; // 1 min
jest.setTimeout(MAX_BUILD_TIME_MS);

const PROJECT_URL = env('TURTLE_TEST_PROJECT_URL');
const DUMMY_BUILD_DISPATCH_DATA = JSON.stringify({
  type: 'dispatch',
  buildId,
  job: {
    mode: 'build',
    secrets: {
      buildCredentials: ANDROID_CREDENTIALS,
    },
    platform: 'android',
    type: 'generic',
    projectArchive: {
      type: ArchiveSourceType.URL,
      url: PROJECT_URL,
    },
    projectRootDirectory: './generic',
    gradleCommand: ':app:bundleRelease',
    applicationArchivePath: 'android/app/build/outputs/**/*.{apk,aab}',
  },
  initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
  metadata: {
    trackingContext: {},
  },
});

jest.mock('../upload');
jest.mock('../build');
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
    await new Promise((res) => {
      server.close(res);
    });
    jest.resetAllMocks();
  });

  afterAll(async () => {
    await cleanUpWorkingdir();
  });

  describe('build successfully and send buildSuccess message', () => {
    let successPromiseResolve: () => void;
    const successPromise = new Promise<void>((res) => {
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
    describe('close message received from launcher', () => {
      it('should terminate worker without notifying sentry', async () => {
        require('../build').setShouldSucceed(true);
        const [ws, helper, messageTimeout] = await setUpTestAsync(port, onMessage);
        ws.send(DUMMY_BUILD_DISPATCH_DATA);
        await successPromise;
        clearTimeout(messageTimeout);

        const closePromise = helper.onClose();
        ws.send(JSON.stringify({ type: 'close' }));
        await closePromise;

        await promise.sleep(10 * 1000);
        expect(spyReportHangingWorker).not.toHaveBeenCalled();
      });
    });

    describe('close message received from launcher, but something went wrong and shouldCloseWorker is not true', () => {
      it('should log message and notify sentry about possibly hanging', async () => {
        require('../build').setShouldSucceed(true);
        const [ws, helper, messageTimeout] = await setUpTestAsync(port, onMessage);
        ws.send(DUMMY_BUILD_DISPATCH_DATA);
        await successPromise;
        clearTimeout(messageTimeout);

        const actualCloseWorker = partialMockService.closeWorker;
        partialMockService.closeWorker = jest.fn(() => {});
        ws.send(JSON.stringify({ type: 'close' }));

        await promise.sleep(10 * 1000);
        expect(spyReportHangingWorker).toHaveBeenCalled();

        partialMockService.closeWorker = actualCloseWorker;
        const closePromise = helper.onClose();
        ws.send(JSON.stringify({ type: 'close' }));
        await closePromise;
      });
    });

    describe('no close message received from launcher in specified time', () => {
      it('should log message and notify sentry about possibly hanging', async () => {
        require('../build').setShouldSucceed(true);
        const [ws, helper, messageTimeout] = await setUpTestAsync(port, onMessage);
        ws.send(DUMMY_BUILD_DISPATCH_DATA);
        await successPromise;
        clearTimeout(messageTimeout);

        await promise.sleep(10 * 1000);
        expect(spyReportHangingWorker).toHaveBeenCalled();

        const closePromise = helper.onClose();
        ws.send(JSON.stringify({ type: 'close' }));
        await closePromise;
      });
    });
  });
});
