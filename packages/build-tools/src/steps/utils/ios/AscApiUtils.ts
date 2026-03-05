import { UserFacingError } from '@expo/eas-build-job/dist/errors';

import {
  AscApiClient,
  AscApiClientGetApi,
  AscApiClientPostApi,
  AscApiRequestError,
} from './AscApiClient';

export namespace AscApiUtils {
  export async function getAppInfoAsync({
    client,
    appleAppIdentifier,
  }: {
    client: Pick<AscApiClient, 'getAsync'>;
    appleAppIdentifier: string;
  }): Promise<AscApiClientGetApi['/v1/apps/:id']['response']> {
    try {
      return await client.getAsync(
        '/v1/apps/:id',
        { 'fields[apps]': ['bundleId', 'name'] },
        { id: appleAppIdentifier }
      );
    } catch (error) {
      const authErrors =
        error instanceof AscApiRequestError && error.status === 401
          ? error.responseJson.errors
          : [];
      const isAuthError =
        authErrors.length > 0 && authErrors.every(item => item.code === 'NOT_AUTHORIZED');
      if (isAuthError) {
        throw new UserFacingError(
          'EAS_UPLOAD_TO_ASC_INVALID_AUTH',
          'App Store Connect rejected the API authentication credentials. ' +
            'Verify that the API key JSON is valid (`issuer_id`, `key_id`, `key`), the key is active in App Store Connect, and it belongs to the correct App Store Connect account with sufficient access. Then retry submit.',
          {
            cause: error,
            docsUrl: 'https://docs.expo.dev/submit/ios/',
          }
        );
      }

      const notFoundErrors =
        error instanceof AscApiRequestError && error.status === 404
          ? error.responseJson.errors
          : [];
      const isAppNotFoundError =
        notFoundErrors.length > 0 && notFoundErrors.every(item => item.code === 'NOT_FOUND');
      if (!isAppNotFoundError) {
        throw error;
      }

      let visibleAppsSummary: string | null = null;
      try {
        visibleAppsSummary = await getVisibleAppsSummaryAsync(client);
      } catch {
        // Don't hide the original NOT_FOUND error with a secondary lookup failure.
        throw error;
      }
      throw new UserFacingError(
        'EAS_UPLOAD_TO_ASC_APP_NOT_FOUND',
        `App Store Connect app for application identifier ${appleAppIdentifier} was not found. ` +
          'Verify the configured application identifier and that the App Store Connect API key has access to the application in the correct App Store Connect account.' +
          (visibleAppsSummary
            ? `\n\nExample applications visible to this API key:\n${visibleAppsSummary}`
            : ''),
        {
          cause: error,
          docsUrl: 'https://expo.fyi/asc-app-id',
        }
      );
    }
  }

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
      const authErrors =
        error instanceof AscApiRequestError && error.status === 401
          ? error.responseJson.errors
          : [];
      const isAuthError =
        authErrors.length > 0 && authErrors.every(item => item.code === 'NOT_AUTHORIZED');
      if (isAuthError) {
        throw new UserFacingError(
          'EAS_UPLOAD_TO_ASC_INVALID_AUTH',
          'App Store Connect rejected the API authentication credentials. ' +
            'Verify that the API key JSON is valid (`issuer_id`, `key_id`, `key`), the key is active in App Store Connect, and it belongs to the correct App Store Connect account with sufficient access. Then retry submit.',
          {
            cause: error,
            docsUrl: 'https://docs.expo.dev/submit/ios/',
          }
        );
      }

      const errors =
        error instanceof AscApiRequestError && error.status === 409
          ? error.responseJson.errors
          : [];
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

async function getVisibleAppsSummaryAsync(
  client: Pick<AscApiClient, 'getAsync'>
): Promise<string | null> {
  const appsResponse = await client.getAsync('/v1/apps', {
    'fields[apps]': ['bundleId', 'name'],
    limit: 10,
  });
  if (appsResponse.data.length === 0) {
    return '  (none)';
  }
  return appsResponse.data
    .map(app => `- ${app.attributes.name} (${app.attributes.bundleId}) (ID: ${app.id})`)
    .join('\n');
}
