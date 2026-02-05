import nock from 'nock';

jest.mock('node-fetch', () => jest.requireActual('node-fetch'));

import { AscApiClient } from '../AscApiClient';

describe(AscApiClient, () => {
  const token = 'test-token';
  const client = new AscApiClient({ token });

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('fetches app info', async () => {
    const appId = '1491144534';
    const responseFixture = require('./fixtures/apps/get-apps-200.json');

    const scope = nock('https://api.appstoreconnect.apple.com')
      .get(`/v1/apps/${appId}`)
      .query({ 'fields[apps]': 'bundleId,name' })
      .reply(200, responseFixture);

    const result = await client.getAsync(
      '/v1/apps/:id',
      { 'fields[apps]': ['bundleId', 'name'] },
      { id: appId }
    );

    expect(result).toEqual({
      data: {
        type: 'apps',
        id: appId,
        attributes: {
          name: 'turtle-cli-example',
          bundleId: 'com.expo.turtle.cli.example',
        },
      },
    });
    expect(scope.isDone()).toBeTruthy();
  });

  it('creates build upload', async () => {
    const buildUploadId = 'fdf9c476-aaa4-4ead-b91c-6e3cc3a47805';
    const responseFixture = require('./fixtures/buildUploads/post-buildUploads-200.json');

    const scope = nock('https://api.appstoreconnect.apple.com')
      .post('/v1/buildUploads', {
        data: {
          type: 'buildUploads',
          attributes: {
            platform: 'IOS',
            cfBundleShortVersionString: '1.0',
            cfBundleVersion: '13',
          },
          relationships: {
            app: {
              data: {
                type: 'apps',
                id: '1491144534',
              },
            },
          },
        },
      })
      .reply(200, responseFixture);

    const result = await client.postAsync('/v1/buildUploads', {
      data: {
        type: 'buildUploads',
        attributes: {
          platform: 'IOS',
          cfBundleShortVersionString: '1.0',
          cfBundleVersion: '13',
        },
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: '1491144534',
            },
          },
        },
      },
    });

    expect(result).toEqual({
      data: {
        type: 'buildUploads',
        id: buildUploadId,
      },
    });
    expect(scope.isDone()).toBeTruthy();
  });

  it('creates build upload file', async () => {
    const buildUploadId = 'fdf9c476-aaa4-4ead-b91c-6e3cc3a47805';
    const fileId = '5b110930-f947-4998-a129-5926ffcedde5';
    const responseFixture = require('./fixtures/buildUploadFiles/post-buildUploadFiles-201.json');

    const scope = nock('https://api.appstoreconnect.apple.com')
      .post('/v1/buildUploadFiles', {
        data: {
          type: 'buildUploadFiles',
          attributes: {
            assetType: 'ASSET',
            fileName: 'app.ipa',
            fileSize: 359,
            uti: 'com.apple.ipa',
          },
          relationships: {
            buildUpload: {
              data: {
                type: 'buildUploads',
                id: buildUploadId,
              },
            },
          },
        },
      })
      .reply(201, responseFixture);

    const result = await client.postAsync('/v1/buildUploadFiles', {
      data: {
        type: 'buildUploadFiles',
        attributes: {
          assetType: 'ASSET',
          fileName: 'app.ipa',
          fileSize: 359,
          uti: 'com.apple.ipa',
        },
        relationships: {
          buildUpload: {
            data: {
              type: 'buildUploads',
              id: buildUploadId,
            },
          },
        },
      },
    });

    expect(result).toEqual({
      data: {
        type: 'buildUploadFiles',
        id: fileId,
        attributes: {
          uploadOperations: [
            {
              method: 'PUT',
              url: 'https://storage/upload',
              length: 359,
              offset: 0,
              requestHeaders: [
                {
                  name: 'Content-Type',
                  value: 'application/json',
                },
              ],
              partNumber: 1,
            },
          ],
        },
      },
    });
    expect(scope.isDone()).toBeTruthy();
  });

  it('commits upload', async () => {
    const fileId = '5b110930-f947-4998-a129-5926ffcedde5';
    const responseFixture = require('./fixtures/buildUploadFiles/patch-buildUploadFiles-200.json');

    const scope = nock('https://api.appstoreconnect.apple.com')
      .patch(`/v1/buildUploadFiles/${fileId}`, {
        data: {
          type: 'buildUploadFiles',
          id: fileId,
          attributes: {
            uploaded: true,
          },
        },
      })
      .reply(200, responseFixture);

    const result = await client.patchAsync(
      '/v1/buildUploadFiles/:id',
      {
        data: {
          type: 'buildUploadFiles',
          id: fileId,
          attributes: {
            uploaded: true,
          },
        },
      },
      { id: fileId }
    );

    expect(result).toEqual({
      data: {
        type: 'buildUploadFiles',
        id: fileId,
        attributes: {
          assetDeliveryState: responseFixture.data.attributes.assetDeliveryState,
        },
      },
    });
    expect(scope.isDone()).toBeTruthy();
  });

  it('fetches build upload info', async () => {
    const buildUploadId = 'fdf9c476-aaa4-4ead-b91c-6e3cc3a47805';
    const responseFixture = require('./fixtures/buildUploads/get-buildUploads-200.json');

    const scope = nock('https://api.appstoreconnect.apple.com')
      .get(`/v1/buildUploads/${buildUploadId}`)
      .query({
        'fields[buildUploads]': 'build,state',
        include: 'build',
      })
      .reply(200, responseFixture);

    const result = await client.getAsync(
      '/v1/buildUploads/:id',
      {
        'fields[buildUploads]': ['build', 'state'],
        include: ['build'],
      },
      { id: buildUploadId }
    );

    expect(result).toEqual({
      data: {
        type: 'buildUploads',
        id: buildUploadId,
        attributes: {
          state: responseFixture.data.attributes.state,
        },
      },
    });
    expect(scope.isDone()).toBeTruthy();
  });

  it('fetches build upload file info', async () => {
    const fileId = '5b110930-f947-4998-a129-5926ffcedde5';
    const responseFixture = require('./fixtures/buildUploadFiles/get-buildUploadFiles-200.json');

    const scope = nock('https://api.appstoreconnect.apple.com')
      .get(`/v1/buildUploadFiles/${fileId}`)
      .query({
        'fields[buildUploadFiles]': 'assetDeliveryState',
      })
      .reply(200, responseFixture);

    const result = await client.getAsync(
      '/v1/buildUploadFiles/:id',
      {
        'fields[buildUploadFiles]': ['assetDeliveryState'],
      },
      { id: fileId }
    );

    expect(result).toEqual({
      data: {
        type: 'buildUploadFiles',
        id: fileId,
        attributes: {
          assetDeliveryState: responseFixture.data.attributes.assetDeliveryState,
        },
      },
    });
    expect(scope.isDone()).toBeTruthy();
  });
});
