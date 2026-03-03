import { AscApiRequestError } from '../AscApiClient';
import { AscApiUtils } from '../AscApiUtils';

describe('AscApiUtils', () => {
  describe(AscApiUtils.createBuildUploadAsync, () => {
    it('throws UserFacingError when ASC duplicate version error is returned', async () => {
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
