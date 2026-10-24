import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { setTimeout } from 'node:timers/promises';

import { readIpaInfoAsync } from '../../functions/readIpaInfo';

import { AscApiClient } from './AscApiClient';
import { AscApiUtils } from './AscApiUtils';

export async function waitForAscBuildProcessingAsync({
  client,
  buildUploadId,
  logger,
  ipaPath,
  appleAppIdentifier,
  ascAppBundleIdentifier,
  bundleShortVersion,
}: {
  client: AscApiClient;
  buildUploadId: string;
  logger: bunyan;
  ipaPath?: string;
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
        const ipaInfoResult = ipaPath ? await asyncResult(readIpaInfoAsync(ipaPath)) : null;
        const ipaBundleIdentifier = ipaInfoResult?.ok ? ipaInfoResult.value.bundleIdentifier : null;

        if (!ascAppBundleIdentifier && appleAppIdentifier) {
          try {
            const app = await AscApiUtils.getAppInfoAsync({ client, appleAppIdentifier });
            ascAppBundleIdentifier = app.data.attributes.bundleId;
          } catch {
            // Keep the processing error if app details are unavailable.
          }
        }
        let visibleAppsSummary: string | null = null;
        try {
          const apps = await AscApiUtils.getAppsAsync({ client, limit: 5 });
          visibleAppsSummary = AscApiUtils.formatAppsList(apps);
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
