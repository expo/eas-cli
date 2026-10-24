import { SystemError, UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import * as jose from 'jose';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';

import { isConnectionInterruptedError } from '../../../utils/networkErrors';
import { promiseRetryWithCondition } from '../../../utils/promiseRetryWithCondition';

import {
  AscApiClient,
  AscApiClientGetApi,
  AscApiClientPostApi,
  AscApiKey,
  AscApiRequestError,
  AscPlatform,
} from './AscApiClient';

export namespace AscApiUtils {
  export async function commitBuildUploadFileAsync({
    client,
    fileId,
    logger,
  }: {
    client: AscApiClient;
    fileId: string;
    logger: bunyan;
  }): Promise<void> {
    try {
      await promiseRetryWithCondition(
        async () => {
          const { data } = await client.getAsync(
            '/v1/buildUploadFiles/:id',
            { 'fields[buildUploadFiles]': ['assetDeliveryState'] },
            { id: fileId }
          );
          if (['COMPLETE', 'FAILED'].includes(data.attributes.assetDeliveryState.state)) {
            return;
          }
          await client.patchAsync(
            '/v1/buildUploadFiles/:id',
            { data: { type: 'buildUploadFiles', id: fileId, attributes: { uploaded: true } } },
            { id: fileId }
          );
        },
        error => isConnectionInterruptedError(error),
        { retries: 3, factor: 1, minTimeout: 2000 },
        ({ attemptNumber, maxAttemptsCount, error }) =>
          logger.warn(
            { err: error },
            `Checking upload file before commit attempt ${attemptNumber}/${maxAttemptsCount}.`
          )
      )();
    } catch (error) {
      if (!isConnectionInterruptedError(error)) {
        throw error;
      }
      // Apple may have accepted the final commit even though its response was lost.
      try {
        const { data } = await client.getAsync(
          '/v1/buildUploadFiles/:id',
          { 'fields[buildUploadFiles]': ['assetDeliveryState'] },
          { id: fileId }
        );
        if (data.attributes.assetDeliveryState.state === 'COMPLETE') {
          logger.info(`Upload file ${fileId}: COMPLETE confirmed after the final commit error.`);
          return;
        }
      } catch (readError) {
        logger.warn(
          { err: readError },
          `Could not check upload file ${fileId} after the final commit error.`
        );
      }
      throw error;
    }
  }

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

  export async function waitForAscBuildProcessingAsync({
    client,
    buildUploadId,
    logger,
    ipaBundleIdentifier,
    appleAppIdentifier,
    ascAppBundleIdentifier,
    bundleShortVersion,
  }: {
    client: AscApiClient;
    buildUploadId: string;
    logger: bunyan;
    ipaBundleIdentifier?: string;
    appleAppIdentifier?: string;
    ascAppBundleIdentifier?: string;
    bundleShortVersion?: string;
  }): Promise<void> {
    logger.info('Checking build upload status...');
    const waitingForBuildStartedAt = Date.now();
    const waitingLogIntervalMs = 10 * 1000;
    let lastWaitLogTime = 0;
    let lastWaitLogState: string | null = null;
    while (Date.now() - waitingForBuildStartedAt < 30 * 60 * 1000 /* 30 minutes */) {
      const {
        data: {
          attributes: { state },
        },
      } = await client.getAsync(
        `/v1/buildUploads/:id`,
        { 'fields[buildUploads]': ['state', 'build'], include: ['build'] },
        { id: buildUploadId }
      );

      if (state.state === 'AWAITING_UPLOAD' || state.state === 'PROCESSING') {
        const now = Date.now();
        if (lastWaitLogState !== state.state || now - lastWaitLogTime >= waitingLogIntervalMs) {
          logger.info(`Waiting for build upload to complete... (status = ${state.state})`);
          lastWaitLogTime = now;
          lastWaitLogState = state.state;
        }
        await setTimeout(2000);
        continue;
      }

      logger.info('\n');

      const { errors = [], warnings = [], infos = [] } = state;
      if (infos.length > 0) {
        logger.info(`Infos:\n${itemizeMessages(infos)}\n`);
      }
      if (warnings.length > 0) {
        logger.warn(`Warnings:\n${itemizeMessages(warnings)}\n`);
      }
      if (errors.length > 0) {
        logger.error(`Errors:\n${itemizeMessages(errors)}\n`);
      }

      if (state.state === 'FAILED') {
        if (isSdkVersionIssueError(errors)) {
          throw new UserError(
            'EAS_UPLOAD_TO_ASC_SDK_VERSION_ISSUE',
            'Build upload was rejected by App Store Connect because the IPA was built with an iOS SDK that is too old for current App Store Connect requirements. ' +
              'In an Expo project, this usually means the build used an outdated EAS iOS image or the project still depends on an Expo SDK / native setup that does not support the required Xcode toolchain. ' +
              'Upgrade to a supported Expo SDK if needed and/or select a newer iOS image in `eas.json`, rebuild, and submit again.',
            {
              docsUrl: 'https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/',
            }
          );
        }
        if (isInvalidBundleIdentifierError(errors)) {
          if (!ascAppBundleIdentifier && appleAppIdentifier) {
            try {
              const app = await getAppInfoAsync({ client, appleAppIdentifier });
              ascAppBundleIdentifier = app.data.attributes.bundleId;
            } catch {
              // Keep the processing error if app details are unavailable.
            }
          }
          let visibleAppsSummary: string | null = null;
          try {
            const apps = await getAppsAsync({ client, limit: 5 });
            visibleAppsSummary = formatAppsList(apps);
          } catch {
            // Ok to fail, this is just trying to be helpful.
          }

          throw new UserError(
            'EAS_UPLOAD_TO_ASC_INVALID_BUNDLE_ID',
            `Build upload was rejected by App Store Connect because the app bundle identifier in the IPA does not match the selected App Store Connect app.\n\n` +
              `IPA bundle identifier: ${ipaBundleIdentifier ?? '(unavailable)'}\n` +
              `App Store Connect app bundle identifier: ${ascAppBundleIdentifier ?? '(unavailable)'}\n\n` +
              'Bundle identifier cannot be changed for an existing App Store Connect app. ' +
              'If you selected the wrong app, change the Apple app identifier in the submit profile. ' +
              'If you selected the right app, you may want to select a different build to upload (or rebuild with a different profile).' +
              '\n\nOther App Store Connect apps visible to this API key:\n' +
              (visibleAppsSummary ?? '  (unable to retrieve)'),
            {
              docsUrl: 'https://expo.fyi/asc-app-id',
            }
          );
        }
        if (isMissingPurposeStringError(errors)) {
          const missingUsageDescriptionKeys = parseMissingUsageDescriptionKeys(errors);
          throw new UserError(
            'EAS_UPLOAD_TO_ASC_MISSING_PURPOSE_STRING',
            `Build upload was rejected by App Store Connect because Info.plist is missing one or more privacy purpose strings.\n\n` +
              `${
                missingUsageDescriptionKeys.length > 0
                  ? `Missing keys reported by App Store Connect:\n- ${missingUsageDescriptionKeys.join(
                      '\n- '
                    )}\n\n`
                  : ''
              }` +
              'Add the missing keys with clear user-facing explanations, then rebuild and submit again.\n' +
              'If you use Continuous Native Generation (CNG), update `ios.infoPlist` in app.json/app.config.js.\n' +
              'If you do not use CNG, update your app target Info.plist directly.',
            {
              docsUrl: 'https://docs.expo.dev/guides/permissions/#ios',
            }
          );
        }
        if (isClosedVersionTrainError(errors)) {
          throw new UserError(
            'EAS_UPLOAD_TO_ASC_CLOSED_VERSION_TRAIN',
            `Build upload was rejected by App Store Connect because the ${bundleShortVersion ?? 'selected'} app version is not accepted for new build submissions. ` +
              'This usually means the version train is closed or lower than a previously approved version. ' +
              'Bump the iOS app version (CFBundleShortVersionString, e.g. expo.version) to a higher version, then rebuild and submit again.'
          );
        }
        throw new Error(`Build upload (ID: ${buildUploadId}) failed.`);
      } else if (state.state === 'COMPLETE') {
        logger.info(`Build upload (ID: ${buildUploadId}) complete!`);
        return;
      }
      throw new Error(
        `Unexpected App Store Connect processing state: ${state.state}. Check the build in App Store Connect.`
      );
    }
    throw new UserError(
      'EAS_ASC_BUILD_PROCESSING_TIMEOUT',
      `App Store Connect did not finish processing build upload ${buildUploadId} within 30 minutes. Check its status in App Store Connect before retrying.`
    );
  }

  export function itemizeMessages(messages: { description: string; code: string }[]): string {
    return `- ${messages.map(m => `${m.description} (${m.code})`).join('\n- ')}`;
  }

  export function isClosedVersionTrainError(messages: { code: string }[]): boolean {
    return (
      messages.length > 0 &&
      messages.every(message => ['90062', '90186', '90478'].includes(message.code))
    );
  }

  export function isSdkVersionIssueError(messages: { code: string }[]): boolean {
    return messages.length > 0 && messages.every(message => message.code === '90725');
  }

  export function isInvalidBundleIdentifierError(messages: { code: string }[]): boolean {
    return (
      messages.length > 0 && messages.every(message => ['90054', '90055'].includes(message.code))
    );
  }

  export function isMissingPurposeStringError(messages: { code: string }[]): boolean {
    return messages.length > 0 && messages.every(message => message.code === '90683');
  }

  export function parseMissingUsageDescriptionKeys(messages: { description: string }[]): string[] {
    const usageDescriptionKeyRegex = /\b(\w+UsageDescription)\b/g;
    const keys = new Set<string>();
    for (const message of messages) {
      const matches = message.description.matchAll(usageDescriptionKeyRegex);
      for (const match of matches) {
        keys.add(match[1]);
      }
    }

    return [...keys];
  }
}
