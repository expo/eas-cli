import { hostname } from 'os';

import { env } from '@expo/turtle-common';
import { ArchiveSourceType, Ios } from '@expo/eas-build-job';
import WebSocket from 'ws';

import logger from '../logger';
import { cleanUpWorkingdir, prepareWorkingdir } from '../workingdir';
import startWsServer from '../ws';

import { WsHelper, unreachableCode } from './utils';

const MAX_BUILD_TIME = 60 * 60 * 1000; // 60 min

jest.setTimeout(MAX_BUILD_TIME);

const projectUrl = env('TURTLE_TEST_PROJECT_URL');

const iosCredentials: Ios.BuildCredentials = {
  testapp: {
    provisioningProfileBase64: env('TURTLE_TEST_IOS_PROVISIONING_PROFILE'),
    distributionCertificate: {
      dataBase64: env('TURTLE_TEST_IOS_DISTRIBUTION_CERTIFICATE_DATA'),
      password: env('TURTLE_TEST_IOS_DISTRIBUTION_CERTIFICATE_PASSWORD'),
    },
  },
};

const buildId = 'f38532aa-81a8-4db7-915f-6e7afe46e22f';

jest.mock('../upload');
jest.mock('../ios/xcodeLogs');
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
    buildId: 'f38532aa-81a8-4db7-915f-6e7afe46e22f', // duplication necessary because of mock hoisting
  };
});

describe('iOS build', () => {
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
  });

  afterAll(async () => {
    await cleanUpWorkingdir();
  });

  describe('successful build', () => {
    it.each(['generic', 'managed'])('should build ipa for %s builds', async (type) => {
      const ws = new WebSocket(`ws://localhost:${port}?expo_vm_name=${hostname()}`);
      const helper = new WsHelper(ws);

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
      const openPromise = helper.onOpen();
      helper.onMessage(onMessage);

      await openPromise;
      const messageTimeout = setTimeout(() => {
        unreachableCode('build timeout');
      }, MAX_BUILD_TIME);
      ws.send(
        JSON.stringify({
          type: 'dispatch',
          buildId,
          job: {
            mode: 'build',
            secrets: {
              buildCredentials: iosCredentials,
            },
            platform: 'ios',
            user: {
              userId: 'e9b99e52-fb74-4927-be63-33d7447ddfd4',
              username: 'test1',
            },
            projectRootDirectory: `./${type}`,
            type,
            projectArchive: {
              type: ArchiveSourceType.URL,
              url: projectUrl,
            },
          },
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
});
