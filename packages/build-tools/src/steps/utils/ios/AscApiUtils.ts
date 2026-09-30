import { SystemError, UserError } from '@expo/eas-build-job';
import fs from 'fs-extra';
import * as jose from 'jose';
import { z } from 'zod';

import {
  AscApiClient,
  AscApiClientGetApi,
  AscApiClientPostApi,
  AscApiKey,
  AscApiRequestError,
  AscPlatform,
} from './AscApiClient';

export namespace AscApiUtils {
  export async function getAllBetaBuildLocalizationsAsync({
    client,
    buildId,
  }: {
    client: AscApiClient;
    buildId: string;
  }) {
    let response = await client.getAsync(
      '/v1/builds/:id/betaBuildLocalizations',
      { limit: 200 },
      { id: buildId }
    );
    const localizations = [...response.data];
    for (let page = 1; response.links?.next; page++) {
      if (page === 20) {
        throw new SystemError(
          'We only support TestFlight localization lists with up to 20 pages (4,000 localizations). Contact Expo support if you need a larger localization list.'
        );
      }
      response = await client.getNextPageAsync(
        '/v1/builds/:id/betaBuildLocalizations',
        response.links.next
      );
      localizations.push(...response.data);
    }
    return localizations;
  }

  export async function getAllBetaGroupsAsync({
    client,
    appId,
    buildId,
  }: {
    client: AscApiClient;
  } & ({ appId: string; buildId?: never } | { appId?: never; buildId: string })) {
    let response = await client.getAsync('/v1/betaGroups', {
      ...(buildId !== undefined ? { 'filter[builds]': buildId } : { 'filter[app]': appId }),
      limit: 200,
    });
    const groups = [...response.data];
    for (let page = 1; response.links?.next; page++) {
      if (page === 20) {
        throw new SystemError(
          'We only support TestFlight group lists with up to 20 pages (4,000 groups). Contact Expo support if you need a larger group list.'
        );
      }
      response = await client.getNextPageAsync('/v1/betaGroups', response.links.next);
      groups.push(...response.data);
    }
    return groups;
  }

  export async function loadApiKeyAsync({ keyPath }: { keyPath: string }): Promise<AscApiKey> {
    const keyJson = z
      .object({ issuer_id: z.string().nullish(), key_id: z.string(), key: z.string() })
      .parse(await fs.readJson(keyPath));
    return {
      keyId: keyJson.key_id,
      issuerId: keyJson.issuer_id,
      privateKey: await jose.importPKCS8(keyJson.key, 'ES256'),
    };
  }

  /**
   * Maps a bundle's `DTPlatformName` (from its Info.plist) to the App Store
   * Connect platform used for a build upload. Unknown or missing values fall
   * back to `IOS` to preserve the previous default.
   */
  export function ascPlatformFromDtPlatformName(dtPlatformName: string | null): AscPlatform {
    switch (dtPlatformName) {
      case 'appletvos':
        return 'TV_OS';
      case 'macosx':
        return 'MAC_OS';
      case 'xros':
        return 'VISION_OS';
      case 'iphoneos':
      default:
        return 'IOS';
    }
  }

  /** The App Store Connect TestFlight URL path segment for a platform. */
  export function testFlightPlatformPathSegment(platform: AscPlatform): string {
    switch (platform) {
      case 'TV_OS':
        return 'tvos';
      case 'MAC_OS':
        return 'macos';
      case 'VISION_OS':
        return 'visionos';
      case 'IOS':
      default:
        return 'ios';
    }
  }

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
      const errors = error instanceof AggregateError ? error.errors : [error];
      const isAppNotFoundError =
        errors.length > 0 &&
        errors.every(
          item =>
            item instanceof AscApiRequestError && item.status === 404 && item.code === 'NOT_FOUND'
        );
      if (!isAppNotFoundError) {
        throw error;
      }

      let visibleAppsSummary: string | null = null;
      try {
        const apps = await AscApiUtils.getAppsAsync({ client, limit: 10 });
        visibleAppsSummary = AscApiUtils.formatAppsList(apps);
      } catch {
        // Don't hide the original NOT_FOUND error with a secondary lookup failure.
        throw error;
      }

      throw new UserError(
        'EAS_UPLOAD_TO_ASC_APP_NOT_FOUND',
        `App Store Connect app for application identifier ${appleAppIdentifier} was not found. ` +
          'Verify the configured application identifier and that the App Store Connect API key has access to the application in the correct App Store Connect account.' +
          (visibleAppsSummary
            ? `\n\nExample applications visible to this API key:\n${visibleAppsSummary}`
            : ''),
        {
          docsUrl: 'https://expo.fyi/asc-app-id',
          cause: error,
        }
      );
    }
  }

  export async function createBuildUploadAsync({
    client,
    appleAppIdentifier,
    bundleShortVersion,
    bundleVersion,
    platform,
  }: {
    client: Pick<AscApiClient, 'postAsync'>;
    appleAppIdentifier: string;
    bundleShortVersion: string;
    bundleVersion: string;
    platform: AscPlatform;
  }): Promise<AscApiClientPostApi['/v1/buildUploads']['response']> {
    try {
      return await client.postAsync('/v1/buildUploads', {
        data: {
          type: 'buildUploads',
          attributes: {
            platform,
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
      const errors = error instanceof AggregateError ? error.errors : [error];
      const isDuplicateVersionError =
        errors.length > 0 &&
        errors.every(
          item =>
            item instanceof AscApiRequestError &&
            item.status === 409 &&
            item.code === 'ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE'
        );

      if (isDuplicateVersionError) {
        throw new UserError(
          'EAS_UPLOAD_TO_ASC_VERSION_DUPLICATE',
          `Increment Build Number: Build number ${bundleVersion} for app version ${bundleShortVersion} has already been used. ` +
            'App Store Connect requires unique build numbers within each app version (version train). ' +
            'Increment it by setting ios.buildNumber in app.json, or set "autoIncrement": true in eas.json (recommended). Then rebuild and resubmit.',
          {
            docsUrl: 'https://docs.expo.dev/build-reference/app-versions/',
            cause: error,
          }
        );
      }
      throw error;
    }
  }

  export async function getAppsAsync({
    client,
    limit,
  }: {
    client: Pick<AscApiClient, 'getAsync'>;
    limit?: number;
  }): Promise<AscApiClientGetApi['/v1/apps']['response']['data']> {
    const appsResponse = await client.getAsync('/v1/apps', {
      'fields[apps]': ['bundleId', 'name'],
      limit: limit ?? 10,
    });
    return appsResponse.data;
  }

  export function formatAppsList(apps: AscApiClientGetApi['/v1/apps']['response']['data']): string {
    return (
      apps
        .map(app => `- ${app.attributes.name} (${app.attributes.bundleId}) (ID: ${app.id})`)
        .join('\n') || '  (none)'
    );
  }
}
