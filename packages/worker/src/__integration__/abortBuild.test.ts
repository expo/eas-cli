import {
  BuildContext,
  Hook,
  findAndUploadXcodeBuildLogsAsync,
  runHookIfPresent,
} from '@expo/build-tools';
import { Job } from '@expo/eas-build-job';
import fs from 'fs';
import { hostname } from 'os';
import path from 'path';
import WebSocket from 'ws';

import { WsHelper, unreachableCode } from './utils';
import { createTestAndroidJob, createTestIosJob } from './utils/jobs';
import config from '../config';
import logger from '../logger';
import { cleanUpWorkingdir, prepareWorkingdir } from '../workingdir';
import startWsServer from '../ws';

const buildId = config.buildId;

jest.setTimeout(10 * 1000);
let buildTimeout: NodeJS.Timeout;

// Mock @expo/build-tools at the library boundary
// Builders hang until buildTimeout fires so we can test abort during build
jest.mock('@expo/build-tools', () => {
  const actual = jest.requireActual('@expo/build-tools');
  return {
    ...actual,
    Builders: {
      androidBuilder: jest.fn(
        async () =>
          new Promise<void>(res => {
            buildTimeout = setTimeout(() => {
              res();
              unreachableCode('build finished');
            }, 10 * 1000);
          })
      ),
      iosBuilder: jest.fn(
        async () =>
          new Promise<void>(res => {
            buildTimeout = setTimeout(() => {
              res();
              unreachableCode('build finished');
            }, 10 * 1000);
          })
      ),
    },
    findAndUploadXcodeBuildLogsAsync: jest.fn(() => {
      logger.info('Uploading XCode logs');
    }),
    runHookIfPresent: jest.fn(),
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
  const config = jest.requireActual('../config');
  return {
    __esModule: true,
    ...config,
    default: {
      ...config.default,
      buildId: 'e9b99e52-fb74-4927-be63-33d7447ddfd4',
    },
  };
});

describe('launcher aborts build', () => {
  let port: number;
  let server: WebSocket.Server;
  let messageTimeout: NodeJS.Timeout;

  beforeEach(async () => {
    await prepareWorkingdir();
    fs.writeFileSync(
      path.join(config.workingdir, 'build', 'package.json'),
      JSON.stringify({
        scripts: {},
      })
    );
    port = Math.floor(Math.random() * 10000 + 10000);
    server = startWsServer(port);
    logger.debug(`Listening on port ${port}`);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await new Promise(res => {
      server.close(res);
    });
  });

  afterAll(async () => {
    await cleanUpWorkingdir();
  });

  describe('android', () => {
    describe('build canceled', () => {
      const job = createTestAndroidJob();

      it('does not upload XCode logs and notifies launcher after cleanup', async () => {
        await runTest({ job, buildCanceled: true });
        expect(findAndUploadXcodeBuildLogsAsync).not.toHaveBeenCalled();
      });

      it('executes on_cancel hook if present', async () => {
        fs.writeFileSync(
          path.join(config.workingdir, 'build', 'package.json'),
          JSON.stringify({
            scripts: {
              [Hook.ON_BUILD_CANCEL]: 'echo on_build_cancel',
            },
          })
        );
        await runTest({ job, buildCanceled: true });
        expect(runHookIfPresent).toHaveBeenCalledWith(
          expect.any(BuildContext),
          Hook.ON_BUILD_CANCEL
        );
      });

      it('executes on_cancel hook if present, hook throws an error, error is handled', async () => {
        fs.writeFileSync(
          path.join(config.workingdir, 'build', 'package.json'),
          JSON.stringify({
            scripts: {
              [Hook.ON_BUILD_CANCEL]: 'this_is_not_a_valid_command',
            },
          })
        );
        jest.mocked(runHookIfPresent).mockImplementation(async () => {
          throw new Error('Hook failed');
        });
        await runTest({ job, buildCanceled: true });
        expect(runHookIfPresent).toHaveBeenCalledWith(
          expect.any(BuildContext),
          Hook.ON_BUILD_CANCEL
        );
      });
    });

    describe('build timed out', () => {
      const job = createTestAndroidJob();

      it('does not upload XCode logs and notifies launcher after cleanup', async () => {
        await runTest({ job });
        expect(findAndUploadXcodeBuildLogsAsync).not.toHaveBeenCalled();
      });
    });
  });

  describe('ios', () => {
    describe('build canceled', () => {
      const job = createTestIosJob();

      it('uploads XCode logs and notifies launcher after cleanup', async () => {
        await runTest({ job, buildCanceled: true });
        expect(findAndUploadXcodeBuildLogsAsync).toHaveBeenCalled();
      });

      it('executes on_cancel hook if present', async () => {
        fs.writeFileSync(
          path.join(config.workingdir, 'build', 'package.json'),
          JSON.stringify({
            scripts: {
              [Hook.ON_BUILD_CANCEL]: 'echo on_build_cancel',
            },
          })
        );
        await runTest({ job, buildCanceled: true });
        expect(runHookIfPresent).toHaveBeenCalledWith(
          expect.any(BuildContext),
          Hook.ON_BUILD_CANCEL
        );
      });

      it('executes on_cancel hook if present, hook throws an error, error is handled', async () => {
        fs.writeFileSync(
          path.join(config.workingdir, 'build', 'package.json'),
          JSON.stringify({
            scripts: {
              [Hook.ON_BUILD_CANCEL]: 'this_is_not_a_valid_command',
            },
          })
        );
        jest.mocked(runHookIfPresent).mockImplementation(async () => {
          throw Error('Hook failed');
        });
        await runTest({ job, buildCanceled: true });
        expect(runHookIfPresent).toHaveBeenCalledWith(
          expect.any(BuildContext),
          Hook.ON_BUILD_CANCEL
        );
      });
    });

    describe('build timed out', () => {
      const job = createTestIosJob();

      it('uploads XCode logs and notifies launcher after cleanup', async () => {
        await runTest({ job });
        expect(findAndUploadXcodeBuildLogsAsync).toHaveBeenCalled();
      });

      it('does not execute on_cancel hook even if present', async () => {
        fs.writeFileSync(
          path.join(config.workingdir, 'build', 'package.json'),
          JSON.stringify({
            scripts: {
              [Hook.ON_BUILD_CANCEL]: 'echo on_build_cancel',
            },
          })
        );
        await runTest({ job });
        expect(runHookIfPresent).not.toHaveBeenCalled();
      });
    });
  });

  async function runTest({
    job,
    buildCanceled = false,
  }: {
    job: Job;
    buildCanceled?: boolean;
  }): Promise<void> {
    const dispatchWS = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
    const dispatchHelper = new WsHelper(dispatchWS);
    await dispatchHelper.onOpen();
    logger.info('Connection between launcher and worker open');

    dispatchWS.send(
      JSON.stringify({
        type: 'dispatch',
        buildId,
        job,
        initiatingUserId: '14367e1b-26fc-4c00-aedb-0629d78f8286',
        metadata: {
          trackingContext: {},
        },
      })
    );
    dispatchWS.close();
    await dispatchHelper.onClose();
    logger.info('Dispatch message sent by launcher and received');

    const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
    const helper = new WsHelper(ws);
    let abortedPromiseResolve: () => void;
    const abortedPromise = new Promise<void>(res => {
      abortedPromiseResolve = res;
    });
    const onMessage = jest.fn((message: any) => {
      logger.debug('message received');
      clearTimeout(messageTimeout);
      try {
        expect(message).toBeTruthy();
        expect(message.type).toBe('aborted');
        expect(message.reason).toBe(buildCanceled ? 'cancel' : 'timeout');
      } catch (err) {
        throw err;
      } finally {
        abortedPromiseResolve();
      }
    });
    const openPromise = helper.onOpen();
    helper.onMessage(onMessage);

    await openPromise;
    messageTimeout = setTimeout(() => {
      unreachableCode('aborted timeout');
    }, 3000);
    ws.send(JSON.stringify({ type: 'abort', reason: buildCanceled ? 'cancel' : 'timeout' }));
    logger.info('Abort message sent by launcher');

    await abortedPromise;
    logger.info('Cleanup complete and aborted message sent by worker');

    ws.close();
    clearTimeout(messageTimeout);
    clearTimeout(buildTimeout);
  }
});
