import fs from 'fs-extra';
import * as jose from 'jose';
import nock from 'nock';

import { AscApiClient, AscApiRequestError } from '../AscApiClient';
import { AscApiUtils } from '../AscApiUtils';

jest.unmock('node-fetch');

describe('AscApiUtils', () => {
  describe('loadApiKeyAsync', () => {
    beforeAll(() => nock.disableNetConnect());
    afterAll(() => nock.enableNetConnect());
    afterEach(() => nock.cleanAll());

    it.each([undefined, 'test-issuer'])(
      'loads a key that authenticates ASC requests (issuer: %s)',
      async issuerId => {
        const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
        const keyPath = '/asc-api-key.json';
        await fs.writeJson(keyPath, {
          key_id: 'TESTKEY',
          issuer_id: issuerId,
          key: await jose.exportPKCS8(privateKey),
        });
        const client = new AscApiClient({ key: await AscApiUtils.loadApiKeyAsync({ keyPath }) });
        let token = '';
        const scope = nock('https://api.appstoreconnect.apple.com')
          .get('/v1/apps/app')
          .query(true)
          .reply(function () {
            token = String(this.req.headers.authorization).replace(/^Bearer /, '');
            return [200, require('./fixtures/apps/get-apps-200.json')];
          });

        await client.getAsync(
          '/v1/apps/:id',
          { 'fields[apps]': ['bundleId', 'name'] },
          { id: 'app' }
        );
        await expect(
          jose.jwtVerify(token, publicKey, { audience: 'appstoreconnect-v1' })
        ).resolves.toMatchObject({
          protectedHeader: { kid: 'TESTKEY', alg: 'ES256' },
          payload: issuerId ? { iss: issuerId } : { sub: 'user' },
        });
        expect(scope.isDone()).toBe(true);
      }
    );
  });

  describe('getAppInfoAsync', () => {
    it('returns app info when lookup succeeds', async () => {
      const response = {
        data: {
          type: 'apps',
          id: '1491144534',
          attributes: {
            name: 'Example App',
            bundleId: 'com.example.app',
          },
        },
      } as const;

      const client = {
        getAsync: jest.fn().mockResolvedValue(response),
      };

      await expect(
        AscApiUtils.getAppInfoAsync({ client, appleAppIdentifier: '1491144534' })
      ).resolves.toEqual(response);
    });

    it.each([false, true])(
      'throws UserError with visible apps (aggregate: %s)',
      async aggregate => {
        const notFoundPayload = {
          errors: [
            {
              status: '404',
              code: 'NOT_FOUND',
              detail: "There is no resource of type 'apps' with id '1234567890'",
            },
          ],
        };
        const notFoundError = new AscApiRequestError(
          'Unexpected response (404) from App Store Connect',
          404,
          notFoundPayload.errors[0]
        );
        const client = {
          getAsync: jest
            .fn()
            .mockRejectedValueOnce(
              aggregate ? new AggregateError([notFoundError, notFoundError]) : notFoundError
            )
            .mockResolvedValueOnce({
              data: [
                {
                  type: 'apps',
                  id: '1111111111',
                  attributes: { name: 'Visible App', bundleId: 'com.visible.app' },
                },
              ],
            }),
        };

        await expect(
          AscApiUtils.getAppInfoAsync({ client, appleAppIdentifier: '1234567890' })
        ).rejects.toEqual(
          expect.objectContaining({
            errorCode: 'EAS_UPLOAD_TO_ASC_APP_NOT_FOUND',
            docsUrl: 'https://expo.fyi/asc-app-id',
            message: expect.stringMatching(
              /App Store Connect app for application identifier 1234567890 was not found[\s\S]*- Visible App \(com\.visible\.app\) \(ID: 1111111111\)/
            ),
          })
        );
      }
    );

    it('rethrows original not-found error when app-list lookup fails', async () => {
      const notFoundPayload = {
        errors: [
          {
            status: '404',
            code: 'NOT_FOUND',
          },
        ],
      };
      const notFoundError = new AscApiRequestError(
        'Unexpected response (404) from App Store Connect',
        404,
        notFoundPayload.errors[0]
      );

      const listingError = new Error('listing failed');
      const client = {
        getAsync: jest
          .fn()
          .mockRejectedValueOnce(notFoundError)
          .mockRejectedValueOnce(listingError),
      };

      await expect(
        AscApiUtils.getAppInfoAsync({ client, appleAppIdentifier: '1234567890' })
      ).rejects.toBe(notFoundError);
    });
  });

  describe('formatAppsList', () => {
    it('formats visible apps', () => {
      expect(
        AscApiUtils.formatAppsList([
          {
            type: 'apps',
            id: '1111111111',
            attributes: { name: 'Visible App', bundleId: 'com.visible.app' },
          },
          {
            type: 'apps',
            id: '2222222222',
            attributes: { name: 'Second App', bundleId: 'com.second.app' },
          },
        ])
      ).toBe(
        '- Visible App (com.visible.app) (ID: 1111111111)\n- Second App (com.second.app) (ID: 2222222222)'
      );
    });

    it('returns a placeholder when no visible apps are found', () => {
      expect(AscApiUtils.formatAppsList([])).toBe('  (none)');
    });
  });

  describe('createBuildUploadAsync', () => {
    it.each([false, true])('explains duplicate versions (aggregate: %s)', async aggregate => {
      const payload = {
        errors: [
          {
            status: '409',
            code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE',
            detail: 'The bundle version must be higher than the previously uploaded version.',
          },
        ],
      };
      const duplicateError = new AscApiRequestError(
        'Unexpected response (409) from App Store Connect',
        409,
        payload.errors[0]
      );

      const client = {
        postAsync: jest
          .fn()
          .mockRejectedValue(
            aggregate ? new AggregateError([duplicateError, duplicateError]) : duplicateError
          ),
      };

      await expect(
        AscApiUtils.createBuildUploadAsync({
          client,
          appleAppIdentifier: '1491144534',
          bundleShortVersion: '1.2.3',
          bundleVersion: '42',
          platform: 'IOS',
        })
      ).rejects.toEqual(
        expect.objectContaining({
          errorCode: 'EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE',
          message: expect.stringContaining('Increment Build Number'),
          docsUrl: 'https://docs.expo.dev/build-reference/app-versions/',
        })
      );
    });

    it('returns response when upload initialization succeeds', async () => {
      const response = {
        data: {
          type: 'buildUploads',
          id: 'fdf9c476-aaa4-4ead-b91c-6e3cc3a47805',
        },
      } as const;

      const client = {
        postAsync: jest.fn().mockResolvedValue(response),
      };

      await expect(
        AscApiUtils.createBuildUploadAsync({
          client,
          appleAppIdentifier: '1491144534',
          bundleShortVersion: '1.2.3',
          bundleVersion: '42',
          platform: 'IOS',
        })
      ).resolves.toEqual(response);
    });

    it('sends the requested platform in the build upload attributes', async () => {
      const response = {
        data: {
          type: 'buildUploads',
          id: 'fdf9c476-aaa4-4ead-b91c-6e3cc3a47805',
        },
      } as const;
      const client = {
        postAsync: jest.fn().mockResolvedValue(response),
      };

      await AscApiUtils.createBuildUploadAsync({
        client,
        appleAppIdentifier: '1491144534',
        bundleShortVersion: '1.2.3',
        bundleVersion: '42',
        platform: 'TV_OS',
      });

      expect(client.postAsync).toHaveBeenCalledWith(
        '/v1/buildUploads',
        expect.objectContaining({
          data: expect.objectContaining({
            attributes: expect.objectContaining({ platform: 'TV_OS' }),
          }),
        })
      );
    });

    it.each([false, true])('rethrows unrelated errors (aggregate: %s)', async aggregate => {
      const payload = {
        errors: [
          {
            status: '409',
            code: 'ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE',
          },
          {
            status: '409',
            code: 'SOME_OTHER_ERROR',
          },
        ],
      };
      const errors = payload.errors.map(error => new AscApiRequestError('API error', 409, error));
      const mixedError = aggregate ? new AggregateError(errors) : errors[1];
      const client = {
        postAsync: jest.fn().mockRejectedValue(mixedError),
      };

      await expect(
        AscApiUtils.createBuildUploadAsync({
          client,
          appleAppIdentifier: '1491144534',
          bundleShortVersion: '1.2.3',
          bundleVersion: '42',
          platform: 'IOS',
        })
      ).rejects.toBe(mixedError);
    });
  });

  describe('ascPlatformFromDtPlatformName', () => {
    it('maps known DTPlatformName values to App Store Connect platforms', () => {
      expect(AscApiUtils.ascPlatformFromDtPlatformName('iphoneos')).toBe('IOS');
      expect(AscApiUtils.ascPlatformFromDtPlatformName('appletvos')).toBe('TV_OS');
      expect(AscApiUtils.ascPlatformFromDtPlatformName('macosx')).toBe('MAC_OS');
      expect(AscApiUtils.ascPlatformFromDtPlatformName('xros')).toBe('VISION_OS');
    });

    it('falls back to IOS for unknown or missing values', () => {
      expect(AscApiUtils.ascPlatformFromDtPlatformName(null)).toBe('IOS');
      expect(AscApiUtils.ascPlatformFromDtPlatformName('watchos')).toBe('IOS');
    });
  });

  describe('testFlightPlatformPathSegment', () => {
    it('returns the TestFlight URL segment for each platform', () => {
      expect(AscApiUtils.testFlightPlatformPathSegment('IOS')).toBe('ios');
      expect(AscApiUtils.testFlightPlatformPathSegment('TV_OS')).toBe('tvos');
      expect(AscApiUtils.testFlightPlatformPathSegment('MAC_OS')).toBe('macos');
      expect(AscApiUtils.testFlightPlatformPathSegment('VISION_OS')).toBe('visionos');
    });
  });
});

jest.unmock('node-fetch');
describe('commitBuildUploadFileAsync', () => {
  const client = new AscApiClient({ token: 'test-token' });
  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());
  afterEach(() => {
    try {
      expect(nock.pendingMocks()).toEqual([]);
    } finally {
      nock.cleanAll();
    }
  });
  it('does not replay an upload commit when Apple already accepted it', async () => {
    const scope = nock('https://api.appstoreconnect.apple.com')
      .patch('/v1/buildUploadFiles/file')
      .replyWithError({ code: 'ECONNRESET', message: 'Lost response' })
      .get('/v1/buildUploadFiles/file')
      .query(true)
      .reply(200, {
        data: {
          type: 'buildUploadFiles',
          id: 'file',
          attributes: {
            assetDeliveryState: { state: 'COMPLETE' },
          },
        },
      });
    await expect(
      AscApiUtils.commitBuildUploadFileAsync({ client, fileId: 'file' })
    ).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it.each(['AWAITING_UPLOAD', 'UPLOAD_COMPLETE'])(
    'replays a commit when the file state is %s',
    async state => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .patch('/v1/buildUploadFiles/file')
        .replyWithError({ code: 'ECONNRESET', message: 'Lost response' })
        .get('/v1/buildUploadFiles/file')
        .query(true)
        .reply(200, {
          data: {
            type: 'buildUploadFiles',
            id: 'file',
            attributes: {
              assetDeliveryState: { state },
            },
          },
        })
        .patch('/v1/buildUploadFiles/file')
        .reply(200, {
          data: {
            type: 'buildUploadFiles',
            id: 'file',
            attributes: {
              assetDeliveryState: { state: 'UPLOAD_COMPLETE' },
            },
          },
        });
      await expect(
        AscApiUtils.commitBuildUploadFileAsync({ client, fileId: 'file' })
      ).resolves.toBeUndefined();
      expect(scope.isDone()).toBe(true);
    }
  );
});
