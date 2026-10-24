import fs from 'fs-extra';
import nock from 'nock';
import { generateKeyPairSync } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import {
  createCustomBuildContextMock,
  createGlobalContextMock,
} from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { getEasFunctions } from '../../easFunctions';
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

async function waitAsync(diagnostics: Record<string, string | number> = {}): Promise<void> {
  const fn = getEasFunctions(createCustomBuildContextMock()).find(
    fn => fn.getFullId() === 'eas/wait_for_asc_build_processing'
  )!;
  await fn
    .createBuildStepFromFunctionCall(globalContext(), {
      callInputs: { asc_api_key_path: 'key.json', build_upload_id: 'upload', ...diagnostics },
    })
    .executeAsync();
}

async function uploadAsync(waitForProcessing?: boolean): Promise<void> {
  await fs.outputFile('/project/app.ipa', 'ipa');
  jest.mocked(readIpaInfoAsync).mockResolvedValue({
    bundleIdentifier: 'com.test.ipa',
    bundleVersion: '1',
    bundleShortVersion: '1.0',
    dtPlatformName: 'iphoneos',
  });
  mockUpload();
  const step = createUploadToAscBuildFunction().createBuildStepFromFunctionCall(globalContext(), {
    callInputs: {
      ipa_path: 'app.ipa',
      asc_api_key_path: 'key.json',
      apple_app_identifier: 'app',
      bundle_version: '1',
      bundle_short_version: '1.0',
      ...(waitForProcessing === undefined ? {} : { wait_for_processing: waitForProcessing }),
    },
  });
  await step.executeAsync();
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

it('polls an existing upload through awaiting and processing states until complete', async () => {
  mockProcessing('AWAITING_UPLOAD');
  mockProcessing('PROCESSING');
  mockProcessing('COMPLETE');
  await expect(waitAsync()).resolves.toBeUndefined();
});

it('reports a processing timeout instead of success when Apple is still processing', async () => {
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.mocked(setTimeout).mockImplementation(async () => {
    now += 2000;
  });
  mockProcessing('PROCESSING');
  await expect(waitAsync({ wait_processing_timeout_seconds: 1 })).rejects.toMatchObject({
    errorCode: 'EAS_UPLOAD_TO_ASC_PROCESSING_TIMEOUT',
  });
});

it('uses the supplied bundle identifier in mismatch errors without an IPA', async () => {
  mockProcessing(
    'FAILED',
    ['90054', '90055'].map(code => ({ code, description: 'Bundle mismatch' }))
  );
  mockApp();
  api().get('/v1/apps').query(true).reply(200, { data: [] });
  await expect(
    waitAsync({ bundle_identifier: 'com.test.ipa', apple_app_identifier: 'app' })
  ).rejects.toMatchObject({
    errorCode: 'EAS_UPLOAD_TO_ASC_INVALID_BUNDLE_ID',
    message: expect.stringContaining(
      'IPA bundle identifier: com.test.ipa\nApp Store Connect app bundle identifier: com.test.app'
    ),
  });
});

it.each<[string, string[], string]>([
  ['SDK version', ['90725'], 'EAS_UPLOAD_TO_ASC_SDK_VERSION_ISSUE'],
  ['closed version train', ['90062', '90186', '90478'], 'EAS_UPLOAD_TO_ASC_CLOSED_VERSION_TRAIN'],
])('reports a %s processing error', async (_label, codes, errorCode) => {
  mockProcessing(
    'FAILED',
    codes.map(code => ({ code, description: 'Rejected' }))
  );
  await expect(waitAsync()).rejects.toMatchObject({ errorCode });
});

it.each(
  [
    [],
    ['OTHER'],
    ['90725', 'OTHER'],
    ['90062', 'OTHER'],
    ['90054', 'OTHER'],
    ['90683', 'OTHER'],
  ].map(codes => ({ codes }))
)('keeps unclassified or mixed processing errors generic: $codes', async ({ codes }) => {
  mockProcessing(
    'FAILED',
    codes.map(code => ({ code, description: 'Rejected' }))
  );
  await expect(waitAsync()).rejects.toThrow('Build upload (ID: upload) failed.');
});

it('reports missing privacy keys once each', async () => {
  mockProcessing('FAILED', [
    {
      code: '90683',
      description: 'Missing NSCameraUsageDescription and NSPhotoLibraryUsageDescription.',
    },
    { code: '90683', description: 'Missing NSCameraUsageDescription.' },
  ]);
  await expect(waitAsync()).rejects.toMatchObject({
    errorCode: 'EAS_UPLOAD_TO_ASC_MISSING_PURPOSE_STRING',
    message: expect.stringContaining(
      'Missing keys reported by App Store Connect:\n- NSCameraUsageDescription\n- NSPhotoLibraryUsageDescription\n\n'
    ),
  });
});

it('reports missing privacy purpose strings when Apple does not name a key', async () => {
  mockProcessing('FAILED', [{ code: '90683', description: 'Missing purpose string.' }]);
  await expect(waitAsync()).rejects.toMatchObject({
    errorCode: 'EAS_UPLOAD_TO_ASC_MISSING_PURPOSE_STRING',
    message: expect.not.stringContaining('Missing keys reported by App Store Connect:'),
  });
});

it.each([undefined, false, true])(
  'keeps upload wait_for_processing=%s compatible',
  async waitForProcessing => {
    if (waitForProcessing) {
      mockProcessing('PROCESSING');
      mockProcessing('FAILED', [{ code: '90725', description: 'SDK is too old' }]);
    }
    if (waitForProcessing) {
      await expect(uploadAsync(waitForProcessing)).rejects.toMatchObject({
        errorCode: 'EAS_UPLOAD_TO_ASC_SDK_VERSION_ISSUE',
      });
    } else {
      await expect(uploadAsync(waitForProcessing)).resolves.toBeUndefined();
    }
  }
);

it.each(['upload', 'wait'])(
  'reports the default processing timeout for the %s step',
  async step => {
    mockProcessing('PROCESSING');
    const start = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(start);
    jest.mocked(setTimeout).mockImplementationOnce(async () => {
      jest.spyOn(Date, 'now').mockReturnValue(start + 30 * 60 * 1000);
    });
    await expect(step === 'upload' ? uploadAsync(true) : waitAsync()).rejects.toMatchObject({
      errorCode: 'EAS_UPLOAD_TO_ASC_PROCESSING_TIMEOUT',
    });
  }
);
