import fs from 'fs-extra';
import nock from 'nock';
import { generateKeyPairSync } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { readIpaInfoAsync } from '../readIpaInfo';
import { createUploadToAscBuildFunction } from '../uploadToAsc';

jest.unmock('node-fetch');
jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../readIpaInfo', () => ({
  ...jest.requireActual('../readIpaInfo'),
  readIpaInfoAsync: jest.fn(),
}));

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const api = () => nock('https://api.appstoreconnect.apple.com');
const logger = createMockLogger();
const globalContext = () => createGlobalContextMock({ projectTargetDirectory: '/project', logger });

async function uploadAsync(): Promise<void> {
  await createUploadToAscBuildFunction()
    .createBuildStepFromFunctionCall(globalContext(), {
      callInputs: {
        ipa_path: 'app.ipa',
        asc_api_key_path: 'key.json',
        apple_app_identifier: 'app',
        bundle_version: '1',
        bundle_short_version: '1.0',
        wait_for_processing: true,
      },
    })
    .executeAsync();
}

function mockProcessing(state: string, errors: { code: string; description: string }[] = []): void {
  api()
    .get('/v1/buildUploads/upload')
    .query(true)
    .reply(200, {
      data: { type: 'buildUploads', id: 'upload', attributes: { state: { state, errors } } },
    });
}

function mockApp(): void {
  api()
    .get('/v1/apps/app')
    .query(true)
    .reply(200, {
      data: { type: 'apps', id: 'app', attributes: { name: 'Test app', bundleId: 'com.test.app' } },
    });
}

function mockUpload(): void {
  mockApp();
  api()
    .post('/v1/buildUploads')
    .reply(201, { data: { type: 'buildUploads', id: 'upload' } });
  api()
    .post('/v1/buildUploadFiles')
    .reply(201, {
      data: {
        type: 'buildUploadFiles',
        id: 'file',
        attributes: {
          uploadOperations: [
            {
              length: 3,
              offset: 0,
              partNumber: 1,
              method: 'PUT',
              requestHeaders: [],
              url: 'https://upload.example.com/ipa',
            },
          ],
        },
      },
    });
  nock('https://upload.example.com').put('/ipa', 'ipa').reply(200);
  api()
    .get('/v1/buildUploadFiles/file')
    .query(true)
    .twice()
    .reply(200, {
      data: {
        type: 'buildUploadFiles',
        id: 'file',
        attributes: { assetDeliveryState: { state: 'COMPLETE' } },
      },
    });
}

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
beforeEach(async () => {
  await fs.outputJson('/project/key.json', {
    key_id: 'TESTKEY',
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  await fs.outputFile('/project/app.ipa', 'ipa');
  jest.mocked(readIpaInfoAsync).mockResolvedValue({
    bundleIdentifier: 'com.test.ipa',
    bundleVersion: '1',
    bundleShortVersion: '1.0',
    dtPlatformName: 'iphoneos',
  });
  mockUpload();
  jest.mocked(setTimeout).mockResolvedValue(undefined);
});
afterEach(() => {
  try {
    expect(nock.pendingMocks()).toEqual([]);
  } finally {
    nock.cleanAll();
    jest.restoreAllMocks();
  }
});

it('finishes successfully when Apple completes processing', async () => {
  mockProcessing('PROCESSING');
  mockProcessing('COMPLETE');
  await expect(uploadAsync()).resolves.toBeUndefined();
});

it('fails when Apple does not finish processing within 30 minutes', async () => {
  mockProcessing('PROCESSING');
  const start = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(start);
  jest.mocked(setTimeout).mockImplementationOnce(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(start + 30 * 60 * 1000);
  });
  await expect(uploadAsync()).rejects.toMatchObject({
    errorCode: 'EAS_ASC_BUILD_PROCESSING_TIMEOUT',
  });
});
