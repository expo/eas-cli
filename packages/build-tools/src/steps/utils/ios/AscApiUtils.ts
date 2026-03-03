import { UserFacingError } from '@expo/eas-build-job/dist/errors';

import { AscApiClient, AscApiClientPostApi, AscApiRequestError } from './AscApiClient';

export namespace AscApiUtils {
  export async function createBuildUploadAsync({
    client,
    appleAppIdentifier,
    bundleShortVersion,
    bundleVersion,
  }: {
    client: Pick<AscApiClient, 'postAsync'>;
    appleAppIdentifier: string;
    bundleShortVersion: string;
    bundleVersion: string;
  }): Promise<AscApiClientPostApi['/v1/buildUploads']['response']> {
    try {
      return await client.postAsync('/v1/buildUploads', {
        data: {
          type: 'buildUploads',
          attributes: {
            platform: 'IOS',
            cfBundleShortVersionString: bundleShortVersion,
            cfBundleVersion: bundleVersion,
          },
          relationships: {
            app: {
              data: {
                type: 'apps',
                id: appleAppIdentifier,
              },
            },
          },
        },
      });
    } catch (error) {
      const errors =
        error instanceof AscApiRequestError && error.status === 409 ? error.responseJson.errors : [];
      const isDuplicateVersionError =
        errors.length > 0 &&
        errors.every(item => item.code === 'ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE');

      if (isDuplicateVersionError) {
        throw new UserFacingError(
          'EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE',
          `Increment Build Number: Build number ${bundleVersion} for app version ${bundleShortVersion} has already been used. ` +
            'App Store Connect requires unique build numbers within each app version (version train). ' +
            'Increment it by setting ios.buildNumber in app.json, or set "autoIncrement": true in eas.json (recommended). Then rebuild and resubmit.',
          {
            cause: error,
            docsUrl: 'https://docs.expo.dev/build-reference/app-versions/',
          }
        );
      }
      throw error;
    }
  }
}
