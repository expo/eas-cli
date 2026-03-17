import { AscApiRequestError } from '../AscApiClient';
import { AscApiUtils } from '../AscApiUtils';

describe('AscApiUtils', () => {
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

    it('throws UserError with visible apps when app id is not found', async () => {
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
        notFoundPayload
      );
      const client = {
        getAsync: jest
          .fn()
          .mockRejectedValueOnce(notFoundError)
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
    });

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
        notFoundPayload
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
    it('throws UserError when ASC duplicate version error is returned', async () => {
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
        payload
      );

      const client = {
        postAsync: jest.fn().mockRejectedValue(duplicateError),
      };

      await expect(
        AscApiUtils.createBuildUploadAsync({
          client,
          appleAppIdentifier: '1491144534',
          bundleShortVersion: '1.2.3',
          bundleVersion: '42',
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
        })
      ).resolves.toEqual(response);
    });

    it('rethrows when error payload includes mixed error codes', async () => {
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
      const mixedError = new AscApiRequestError(
        'Unexpected response (409) from App Store Connect',
        409,
        payload
      );
      const client = {
        postAsync: jest.fn().mockRejectedValue(mixedError),
      };

      await expect(
        AscApiUtils.createBuildUploadAsync({
          client,
          appleAppIdentifier: '1491144534',
          bundleShortVersion: '1.2.3',
          bundleVersion: '42',
        })
      ).rejects.toBe(mixedError);
    });
  });
});
