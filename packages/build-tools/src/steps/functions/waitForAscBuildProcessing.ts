import { UserError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';

import { AscApiClient } from '../utils/ios/AscApiClient';
import { AscApiUtils } from '../utils/ios/AscApiUtils';

export function createWaitForAscBuildProcessingBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'wait_for_asc_build_processing',
    name: 'Wait for App Store Connect processing',
    __metricsId: 'eas/wait_for_asc_build_processing',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'asc_api_key_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_upload_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'bundle_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'apple_app_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'bundle_short_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (ctx, { inputs }) => {
      const parsedInputs = z
        .object({
          asc_api_key_path: z.string(),
          build_upload_id: z.string(),
          bundle_identifier: z.string().optional(),
          apple_app_identifier: z.string().optional(),
          bundle_short_version: z.string().optional(),
        })
        .parse({
          asc_api_key_path: inputs.asc_api_key_path.value,
          build_upload_id: inputs.build_upload_id.value,
          bundle_identifier: inputs.bundle_identifier.value,
          apple_app_identifier: inputs.apple_app_identifier.value,
          bundle_short_version: inputs.bundle_short_version.value,
        });
      const keyPath = path.resolve(ctx.workingDirectory, parsedInputs.asc_api_key_path);
      const key = await AscApiUtils.loadApiKeyAsync({ keyPath });
      const client = new AscApiClient({ key, logger: ctx.logger });
      const buildUploadId = parsedInputs.build_upload_id;
      const ipaBundleIdentifier = parsedInputs.bundle_identifier;
      const appleAppIdentifier = parsedInputs.apple_app_identifier;
      const bundleShortVersion = parsedInputs.bundle_short_version;
      const logger = ctx.logger;
      let ascAppBundleIdentifier: string | undefined;
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
          logger.info(`Infos:\n${AscApiUtils.itemizeMessages(infos)}\n`);
        }
        if (warnings.length > 0) {
          logger.warn(`Warnings:\n${AscApiUtils.itemizeMessages(warnings)}\n`);
        }
        if (errors.length > 0) {
          logger.error(`Errors:\n${AscApiUtils.itemizeMessages(errors)}\n`);
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
        }
        break;
      }
    },
  });
}

function isClosedVersionTrainError(messages: { code: string }[]): boolean {
  return (
    messages.length > 0 &&
    messages.every(message => ['90062', '90186', '90478'].includes(message.code))
  );
}

function isSdkVersionIssueError(messages: { code: string }[]): boolean {
  return messages.length > 0 && messages.every(message => message.code === '90725');
}

function isInvalidBundleIdentifierError(messages: { code: string }[]): boolean {
  return (
    messages.length > 0 && messages.every(message => ['90054', '90055'].includes(message.code))
  );
}

function isMissingPurposeStringError(messages: { code: string }[]): boolean {
  return messages.length > 0 && messages.every(message => message.code === '90683');
}

function parseMissingUsageDescriptionKeys(messages: { description: string }[]): string[] {
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
