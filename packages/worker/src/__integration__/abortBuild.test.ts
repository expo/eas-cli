import path from 'path';
import { hostname } from 'os';

import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import WebSocket from 'ws';
import { jobs } from '@expo/turtle-test-utils';
import { Job } from '@expo/eas-build-job';
import { Hook } from '@expo/build-tools';

import { cleanUpWorkingdir, prepareWorkingdir } from '../workingdir';
import startWsServer from '../ws';
import logger from '../logger';
import config from '../config';

import { unreachableCode, WsHelper } from './utils';

const buildId = 'e9b99e52-fb74-4927-be63-33d7447ddfd4';
jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.setTimeout(10 * 1000);
let buildTimeout: NodeJS.Timeout;
jest.mock('../build', () => {
  return {
    ...jest.requireActual('../build'),
    build: async (): Promise<void> => {
      await new Promise<void>((res) => {
        buildTimeout = setTimeout(() => {
          res();
          unreachableCode('build finished');
        }, 10 * 1000);
      });
    },
  };
});
jest.mock('@expo/build-tools', () => {
  return {
    ...jest.requireActual('@expo/build-tools'),
    findAndUploadXcodeBuildLogsAsync: jest.fn(() => {
      logger.info('Uploading XCode logs');
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
    (spawn as jest.Mock).mockReset();
  });

  afterEach(async () => {
    await new Promise((res) => {
      server.close(res);
    });
  });

  afterAll(async () => {
    await cleanUpWorkingdir();
  });

  describe('android', () => {
    describe('build canceled', () => {
      const job = jobs.createTestAndroidJob();

      it('does not upload XCode logs and notifies launcher after cleanup', async () => {
        const findAndUploadXcodeBuildLogsAsyncMock =
          require('@expo/build-tools').findAndUploadXcodeBuildLogsAsync;
        await runTest(job, true);
        expect(findAndUploadXcodeBuildLogsAsyncMock).not.toHaveBeenCalled();
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
        await runTest(job, true);
        expect(spawn).toBeCalledWith(
          expect.anything(),
          ['run', 'eas-build-on-cancel'],
          expect.anything()
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
        const spawnMock = require('@expo/turtle-spawn').default;
        spawnMock.mockImplementation(async () => {
          throw Error('Hook failed');
        });
        await runTest(job, true);
        expect(spawn).toBeCalledWith(
          expect.anything(),
          ['run', 'eas-build-on-cancel'],
          expect.anything()
        );
      });

      it('does not execute on_cancel hook if not present', async () => {
        await runTest(job, true);
        expect(spawn).not.toHaveBeenCalled();
      });
    });

    describe('build timed out', () => {
      const job = jobs.createTestAndroidJob();

      it('does not upload XCode logs and notifies launcher after cleanup', async () => {
        const findAndUploadXcodeBuildLogsAsyncMock =
          require('@expo/build-tools').findAndUploadXcodeBuildLogsAsync;
        await runTest(job, false);
        expect(findAndUploadXcodeBuildLogsAsyncMock).not.toHaveBeenCalled();
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
        await runTest(job, false);
        expect(spawn).not.toHaveBeenCalled();
      });

      it('does not execute on_cancel hook if not present', async () => {
        await runTest(job, false);
        expect(spawn).not.toHaveBeenCalled();
      });
    });
  });

  describe('ios', () => {
    describe('build canceled', () => {
      const job = jobs.createTestIosJob();

      it('uploads XCode logs and notifies launcher after cleanup', async () => {
        const findAndUploadXcodeBuildLogsAsyncMock =
          require('@expo/build-tools').findAndUploadXcodeBuildLogsAsync;
        await runTest(job, true);
        expect(findAndUploadXcodeBuildLogsAsyncMock).toHaveBeenCalled();
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
        await runTest(job, true);
        expect(spawn).toBeCalledWith(
          expect.anything(),
          ['run', 'eas-build-on-cancel'],
          expect.anything()
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
        const spawnMock = require('@expo/turtle-spawn').default;
        spawnMock.mockImplementation(async () => {
          throw Error('Hook failed');
        });
        await runTest(job, true);
        expect(spawn).toBeCalledWith(
          expect.anything(),
          ['run', 'eas-build-on-cancel'],
          expect.anything()
        );
      });

      it('does not execute on_cancel hook if not present', async () => {
        await runTest(job, true);
        expect(spawn).not.toHaveBeenCalled();
      });
    });

    describe('build timed out', () => {
      const job = jobs.createTestIosJob();

      it('uploads XCode logs and notifies launcher after cleanup', async () => {
        const findAndUploadXcodeBuildLogsAsyncMock =
          require('@expo/build-tools').findAndUploadXcodeBuildLogsAsync;
        await runTest(job, false);
        expect(findAndUploadXcodeBuildLogsAsyncMock).toHaveBeenCalled();
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
        await runTest(job, false);
        expect(spawn).not.toHaveBeenCalled();
      });

      it('does not execute on_cancel hook if not present', async () => {
        await runTest(job, false);
        expect(spawn).not.toHaveBeenCalled();
      });
    });
  });

  async function runTest(job: Job, buildCanceled: boolean): Promise<void> {
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
    const abortedPromise = new Promise<void>((res) => {
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
