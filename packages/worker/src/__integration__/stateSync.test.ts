import { Builders, runGenericJobAsync } from '@expo/build-tools';
import { ArchiveSourceType, BuildTrigger, Generic, errors } from '@expo/eas-build-job';
import { result } from '@expo/results';
import { hostname } from 'os';
import { setTimeout as setTimeoutAsync } from 'timers/promises';
import WebSocket from 'ws';

import { WsHelper, unreachableCode } from './utils';
import { createTestAndroidJob } from './utils/jobs';
import logger from '../logger';
import { cleanUpWorkingdir, prepareWorkingdir } from '../workingdir';
import startWsServer from '../ws';

const buildId = 'e9b99e52-fb74-4927-be63-33d7447ddfd4';
const genericJobRunErrorCode = 'EAS_UPLOAD_TO_ASC_APP_NOT_FOUND';

jest.setTimeout(30 * 1000);

function createTestGenericJob(): Generic.Job {
  return {
    projectArchive: {
      type: ArchiveSourceType.URL,
      url: 'https://turtle-v2-test-fixtures.s3.us-east-2.amazonaws.com/project.tar.gz',
    },
    secrets: {
      robotAccessToken: 'token',
      environmentSecrets: [],
    },
    expoDevUrl: 'https://expo.dev',
    builderEnvironment: {
      image: 'ubuntu-22.04',
      env: {},
    },
    triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
    initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
    appId: '8f89da11-f2d1-4db4-b2b5-0d55af4ca4f6',
    steps: [{ run: 'echo hello' }],
  };
}

// Mock @expo/build-tools at the library boundary
jest.mock('@expo/build-tools', () => {
  const actual = jest.requireActual('@expo/build-tools');
  return {
    ...actual,
    Builders: {
      androidBuilder: jest.fn(async () => {
        logger.debug('mocked androidBuilder');
        await setTimeoutAsync(1000);
        return {
          APPLICATION_ARCHIVE: `application-${buildId}`,
        };
      }),
      iosBuilder: jest.fn(async () => {
        logger.debug('mocked iosBuilder');
        await setTimeoutAsync(1000);
        return {
          APPLICATION_ARCHIVE: `application-${buildId}`,
        };
      }),
    },
    runGenericJobAsync: jest.fn(async () => ({
      runResult: result(undefined),
      buildWorkflow: {},
    })),
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
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
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
      const stateResponsePromise = new Promise<void>(res => {
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
          job: createTestAndroidJob(),
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
      const stateResponsePromise = new Promise<void>(res => {
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
          job: createTestAndroidJob(),
          initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
          metadata: {
            trackingContext: {},
          },
        })
      );
      dispatchWS.close();
      await dispatchHelper.onClose();

      await setTimeoutAsync(2000);

      logger.debug('Establising new connection to worker');
      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);

      let stateResponsePromiseResolve: () => void;
      const stateResponsePromise = new Promise<void>(res => {
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
      jest.mocked(Builders.androidBuilder).mockImplementation(async () => {
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
          job: createTestAndroidJob(),
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
      const stateResponsePromise = new Promise<void>(res => {
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

    it('should expose user-facing error from generic job', async () => {
      jest.mocked(runGenericJobAsync).mockResolvedValueOnce({
        runResult: result(
          new errors.UserFacingError(
            genericJobRunErrorCode,
            'ASC app was not found for this account.'
          )
        ),
        buildWorkflow: {} as any,
      });
      const dispatchWS = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const dispatchHelper = new WsHelper(dispatchWS);
      await dispatchHelper.onOpen();
      dispatchWS.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: createTestGenericJob(),
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
      const stateResponsePromise = new Promise<void>(res => {
        stateResponsePromiseResolve = res;
      });
      const onMessage = jest.fn((message: any) => {
        clearTimeout(messageTimeout);
        try {
          expect(message).toBeTruthy();
          expect(message.type).toBe('state-response');
          expect(message.status).toBe('error');
          expect(message.externalBuildError).toEqual({
            errorCode: genericJobRunErrorCode,
            message: 'ASC app was not found for this account.',
          });
          expect(message.internalErrorCode).toBe(genericJobRunErrorCode);
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

    it('should expose tracking code as internal error code from generic job', async () => {
      jest.mocked(runGenericJobAsync).mockResolvedValueOnce({
        runResult: result(
          new errors.BuildError('ASC app was not found for this account.', {
            errorCode: genericJobRunErrorCode,
            trackingCode: 'GENERIC_TRACKING_ERROR',
          })
        ),
        buildWorkflow: {} as any,
      });
      const dispatchWS = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const dispatchHelper = new WsHelper(dispatchWS);
      await dispatchHelper.onOpen();
      dispatchWS.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: createTestGenericJob(),
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
      const stateResponsePromise = new Promise<void>(res => {
        stateResponsePromiseResolve = res;
      });
      const onMessage = jest.fn((message: any) => {
        clearTimeout(messageTimeout);
        try {
          expect(message).toBeTruthy();
          expect(message.type).toBe('state-response');
          expect(message.status).toBe('error');
          expect(message.externalBuildError?.errorCode).toBe(genericJobRunErrorCode);
          expect(message.externalBuildError?.message).toContain(
            'ASC app was not found for this account.'
          );
          expect(message.internalErrorCode).toBe('GENERIC_TRACKING_ERROR');
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
});
