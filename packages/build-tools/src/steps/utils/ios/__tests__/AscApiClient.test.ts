import { UserError } from '@expo/eas-build-job';
import * as jose from 'jose';
import nock from 'nock';

import { AscApiClient, AscApiRequestError } from '../AscApiClient';

// nock needs real fetch implementation
jest.unmock('node-fetch');

describe(AscApiClient, () => {
  let signingKey: jose.KeyLike;
  let client: AscApiClient;

  beforeAll(async () => {
    const { privateKey } = await jose.generateKeyPair('ES256');
    signingKey = privateKey;
    nock.disableNetConnect();
  });

  beforeEach(() => {
    client = new AscApiClient({ key: { keyId: 'TESTKEY', privateKey: signingKey } });
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    jest.useRealTimers();
  });

  it.each([undefined, 'test-issuer'])(
    'reuses tokens and refreshes before expiry (issuer: %s)',
    async issuerId => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
      const startTime = Date.now();
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'] });
      jest.setSystemTime(startTime);
      const refreshingClient = new AscApiClient({
        key: { keyId: 'TESTKEY', issuerId, privateKey },
      });
      const responseFixture = require('./fixtures/buildUploads/get-buildUploads-200.json');
      const tokens: string[] = [];
      const scope = nock('https://api.appstoreconnect.apple.com')
        .get('/v1/buildUploads/upload-id')
        .query(true)
        .times(5)
        .reply(function () {
          tokens.push(String(this.req.headers.authorization).replace(/^Bearer /, ''));
          return [200, responseFixture];
        });

      const requestAsync = async (): Promise<unknown> =>
        await refreshingClient.getAsync(
          '/v1/buildUploads/:id',
          { 'fields[buildUploads]': ['build', 'state'], include: ['build'] },
          { id: 'upload-id' }
        );
      await Promise.all([requestAsync(), requestAsync()]);
      jest.setSystemTime(startTime + 18 * 60 * 1000);
      await requestAsync();
      expect(new Set(tokens).size).toBe(1);

      jest.setSystemTime(startTime + 19 * 60 * 1000);
      await requestAsync();
      expect(tokens[3]).not.toBe(tokens[0]);
      jest.setSystemTime(startTime + 21 * 60 * 1000);
      await requestAsync();
      expect(tokens[4]).toBe(tokens[3]);

      const verificationOptions = {
        currentDate: new Date(Date.now()),
        audience: 'appstoreconnect-v1',
      };
      await expect(jose.jwtVerify(tokens[0], publicKey, verificationOptions)).rejects.toThrow(
        '"exp" claim timestamp check failed'
      );
      await expect(
        jose.jwtVerify(tokens[4], publicKey, verificationOptions)
      ).resolves.toMatchObject({
        payload: issuerId ? { iss: issuerId } : { sub: 'user' },
      });
      expect(scope.isDone()).toBe(true);
    }
  );

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

  it('accepts null or missing hasAccessToAllBuilds for TestFlight groups', async () => {
    nock('https://api.appstoreconnect.apple.com')
      .get('/v1/betaGroups')
      .query({ 'filter[app]': 'app', limit: '200' })
      .reply(200, {
        data: [
          {
            type: 'betaGroups',
            id: 'external',
            attributes: {
              name: 'test external',
              isInternalGroup: false,
              hasAccessToAllBuilds: null,
              publicLinkEnabled: false,
            },
          },
          {
            type: 'betaGroups',
            id: 'internal',
            attributes: { name: 'Internal', isInternalGroup: true },
          },
        ],
        links: { self: 'https://api.appstoreconnect.apple.com/v1/betaGroups' },
      });

    await expect(
      client.getAsync('/v1/betaGroups', { 'filter[app]': 'app', limit: 200 })
    ).resolves.toEqual({
      data: [
        {
          id: 'external',
          attributes: { name: 'test external', isInternalGroup: false, hasAccessToAllBuilds: null },
        },
        { id: 'internal', attributes: { name: 'Internal', isInternalGroup: true } },
      ],
      links: {},
    });
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

  it('requires path parameters for a POST route that has them', async () => {
    await expect(
      // @ts-expect-error The build ID is required by this route.
      client.postAsync('/v1/builds/:id/relationships/betaGroups', { data: [] })
    ).rejects.toThrow();
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
        relationships: { build: { data: null } },
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

  it('explains how to resolve a missing agreement', async () => {
    nock('https://api.appstoreconnect.apple.com')
      .get('/v1/apps/6817395749')
      .query({ 'fields[apps]': 'bundleId,name' })
      .reply(403, {
        errors: [{ code: 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED' }],
      });

    const request = client.getAsync(
      '/v1/apps/:id',
      { 'fields[apps]': ['bundleId', 'name'] },
      { id: '6817395749' }
    );
    await expect(request).rejects.toBeInstanceOf(UserError);
    await expect(request).rejects.toThrow(
      /Account Holder.*https:\/\/appstoreconnect.apple.com\/business/
    );
  });

  it('throws AscApiRequestError for structured ASC error payload', async () => {
    const appId = '1491144534';
    const responseFixture = {
      errors: [
        {
          status: '409',
          code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE',
          title:
            'The provided entity includes an attribute with a value that has already been used',
          detail: 'The bundle version must be higher than the previously uploaded version.',
          links: { see: '/business' },
        },
      ],
    };

    nock('https://api.appstoreconnect.apple.com')
      .get(`/v1/apps/${appId}`)
      .query({ 'fields[apps]': 'bundleId,name' })
      .reply(409, responseFixture);

    await expect(
      client.getAsync('/v1/apps/:id', { 'fields[apps]': ['bundleId', 'name'] }, { id: appId })
    ).rejects.toMatchObject({
      message: `Unexpected response (409) from App Store Connect: ${JSON.stringify(responseFixture.errors[0])}`,
      status: 409,
      code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE',
      responseJson: responseFixture.errors[0],
    });
  });

  it('aggregates agreement and generic errors without losing either', async () => {
    const forbidden = { code: 'FORBIDDEN', detail: 'Access denied.' };
    nock('https://api.appstoreconnect.apple.com')
      .get('/v1/apps/6817395749')
      .query({ 'fields[apps]': 'bundleId,name' })
      .reply(403, {
        errors: [{ code: 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED' }, forbidden],
      });

    const request = client.getAsync(
      '/v1/apps/:id',
      { 'fields[apps]': ['bundleId', 'name'] },
      { id: '6817395749' }
    );
    await expect(request).rejects.toBeInstanceOf(AggregateError);
    await expect(request).rejects.toHaveProperty('errors', [
      expect.any(UserError),
      expect.any(AscApiRequestError),
    ]);
    await expect(request).rejects.toThrow(/Account Holder/);
    await expect(request).rejects.toThrow(/Access denied/);
    await expect(request).rejects.toHaveProperty('errors.1.responseJson', forbidden);
  });

  it('throws regular Error for non-structured ASC error payload', async () => {
    const appId = '1491144534';

    const scope = nock('https://api.appstoreconnect.apple.com')
      .get(`/v1/apps/${appId}`)
      .query({ 'fields[apps]': 'bundleId,name' })
      .reply(503, 'Service unavailable');

    await expect(
      client.getAsync('/v1/apps/:id', { 'fields[apps]': ['bundleId', 'name'] }, { id: appId })
    ).rejects.toThrow('Unexpected response (503)');
    expect(scope.isDone()).toBe(true);
  });

  it('throws controlled error when success response body is not valid JSON', async () => {
    const appId = '1491144534';

    nock('https://api.appstoreconnect.apple.com')
      .get(`/v1/apps/${appId}`)
      .query({ 'fields[apps]': 'bundleId,name' })
      .reply(200, 'not-json');

    await expect(
      client.getAsync('/v1/apps/:id', { 'fields[apps]': ['bundleId', 'name'] }, { id: appId })
    ).rejects.toThrow('Malformed JSON response from App Store Connect (200): not-json');
  });

  it.each(['ECONNRESET', 'EAI_AGAIN'])('recovers a status read after %s', async code => {
    const fixture = require('./fixtures/buildUploadFiles/get-buildUploadFiles-200.json');
    const scope = nock('https://api.appstoreconnect.apple.com')
      .get('/v1/buildUploadFiles/file')
      .query(true)
      .replyWithError({ code, message: 'Temporary network failure' })
      .get('/v1/buildUploadFiles/file')
      .query(true)
      .reply(200, fixture);
    await expect(
      client.getAsync(
        '/v1/buildUploadFiles/:id',
        { 'fields[buildUploadFiles]': ['assetDeliveryState'] },
        { id: 'file' }
      )
    ).resolves.toMatchObject({ data: { id: fixture.data.id } });
    expect(scope.isDone()).toBe(true);
  });

  it.each([401, 422, 429, 503])('does not retry permanent HTTP %s errors', async status => {
    const scope = nock('https://api.appstoreconnect.apple.com')
      .get('/v1/apps/app')
      .query(true)
      .reply(status, { errors: [{ status: String(status) }] });
    await expect(
      client.getAsync(
        '/v1/apps/:id',
        {
          'fields[apps]': ['bundleId', 'name'],
        },
        { id: 'app' }
      )
    ).rejects.toBeInstanceOf(AscApiRequestError);
    expect(scope.isDone()).toBe(true);
  });

  it('does not retry creating a localization after a lost response', async () => {
    const scope = nock('https://api.appstoreconnect.apple.com')
      .post('/v1/betaBuildLocalizations')
      .replyWithError({ code: 'ECONNRESET', message: 'Lost response' });
    await expect(
      client.postAsync('/v1/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: 'en-US', whatsNew: 'Hello' },
          relationships: { build: { data: { type: 'builds', id: 'build' } } },
        },
      })
    ).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(scope.isDone()).toBe(true);
  });

  it('retries connection establishment failure before a creation request', async () => {
    const scope = nock('https://api.appstoreconnect.apple.com')
      .post('/v1/betaBuildLocalizations')
      .replyWithError({ code: 'EAI_AGAIN', message: 'DNS failure' })
      .post('/v1/betaBuildLocalizations')
      .reply(201, { data: { id: 'localization' } });
    await expect(
      client.postAsync('/v1/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: 'en-US', whatsNew: 'Hello' },
          relationships: { build: { data: { type: 'builds', id: 'build' } } },
        },
      })
    ).resolves.toEqual({ data: { id: 'localization' } });
    expect(scope.isDone()).toBe(true);
  });

  it('stops after three retries of an interrupted read', async () => {
    const scope = nock('https://api.appstoreconnect.apple.com')
      .get('/v1/apps/app')
      .query(true)
      .times(4)
      .replyWithError({ code: 'ECONNRESET', message: 'Connection reset' });
    await expect(
      client.getAsync(
        '/v1/apps/:id',
        {
          'fields[apps]': ['bundleId', 'name'],
        },
        { id: 'app' }
      )
    ).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(scope.isDone()).toBe(true);
  });

  it('does not repeat an interrupted changelog update', async () => {
    const body = {
      data: { type: 'betaBuildLocalizations', id: 'locale', attributes: { whatsNew: 'Hello' } },
    } as const;
    const scope = nock('https://api.appstoreconnect.apple.com')
      .patch('/v1/betaBuildLocalizations/locale', body)
      .replyWithError({ code: 'ECONNRESET', message: 'Response lost' })
      .patch('/v1/betaBuildLocalizations/locale', body)
      .optionally()
      .reply(200, { data: { id: 'locale' } });
    await expect(
      client.patchAsync('/v1/betaBuildLocalizations/:id', body, { id: 'locale' })
    ).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(scope.isDone()).toBe(true);
  });
});
