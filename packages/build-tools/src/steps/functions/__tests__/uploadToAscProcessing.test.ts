import fs from 'fs-extra';
import nock from 'nock';
import { generateKeyPairSync } from 'node:crypto';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createUploadToAscBuildFunction } from '../uploadToAsc';

jest.unmock('node-fetch');
jest.mock('../readIpaInfo', () => ({
  readIpaInfoAsync: async () => ({ dtPlatformName: 'iphoneos' }),
}));

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());
afterEach(() => {
  try {
    expect(nock.pendingMocks()).toEqual([]);
  } finally {
    nock.cleanAll();
  }
});

it.each(['COMPLETE', 'PROCESSING'] as const)(
  'only reports success when Apple processing is COMPLETE (received %s)',
  async state => {
    await fs.ensureDir('/tmp');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    await fs.writeJson('/tmp/key.json', {
      key_id: 'TESTKEY',
      key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
    await fs.writeFile('/tmp/app.ipa', 'test');
    const api = nock('https://api.appstoreconnect.apple.com');
    api
      .get('/v1/apps/app')
      .query(true)
      .reply(200, {
        data: { id: 'app', type: 'apps', attributes: { name: 'App', bundleId: 'dev.test' } },
      });
    api.post('/v1/buildUploads').reply(201, { data: { id: 'upload', type: 'buildUploads' } });
    api.post('/v1/buildUploadFiles').reply(201, {
      data: { id: 'file', type: 'buildUploadFiles', attributes: { uploadOperations: [] } },
    });
    const file = {
      data: {
        id: 'file',
        type: 'buildUploadFiles',
        attributes: { assetDeliveryState: { state: 'COMPLETE' } },
      },
    };
    api.get('/v1/buildUploadFiles/file').query(true).twice().reply(200, file);
    api
      .get('/v1/buildUploads/upload')
      .query(true)
      .reply(200, {
        data: { id: 'upload', type: 'buildUploads', attributes: { state: { state } } },
      });
    const step = createUploadToAscBuildFunction().createBuildStepFromFunctionCall(
      createGlobalContextMock(),
      {
        callInputs: {
          ipa_path: '/tmp/app.ipa',
          asc_api_key_path: '/tmp/key.json',
          apple_app_identifier: 'app',
          bundle_version: '1',
          bundle_short_version: '1.0',
          wait_for_processing: true,
          wait_processing_timeout_seconds: 1,
        },
      }
    );
    if (state === 'COMPLETE') {
      await expect(step.executeAsync()).resolves.toBeUndefined();
    } else {
      await expect(step.executeAsync()).rejects.toThrow('Apple did not finish processing');
    }
  }
);
