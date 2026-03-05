import { UserFacingError } from '@expo/eas-build-job/dist/errors';
import { asyncResult } from '@expo/results';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import fs from 'fs-extra';
import * as jose from 'jose';
import fetch from 'node-fetch';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';

import { AscApiClient, AscApiClientPostApi } from '../utils/ios/AscApiClient';
import { AscApiUtils } from '../utils/ios/AscApiUtils';
import { readIpaInfoAsync } from './readIpaInfo';

export function createUploadToAscBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'upload_to_asc',
    name: 'Upload to App Store Connect',
    __metricsId: 'eas/upload_to_asc',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'ipa_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'asc_api_key_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'apple_app_identifier',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'bundle_version',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'bundle_short_version',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'wait_for_processing',
        required: false,
        defaultValue: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'build_upload_id',
        required: false,
      }),
      BuildStepOutput.createProvider({
        id: 'build_upload_url',
        required: false,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs }) => {
      const ipaPathInput = z.string().parse(inputs.ipa_path.value);
      const ascApiKeyPathInput = z.string().parse(inputs.asc_api_key_path.value);
      const appleAppIdentifier = z.string().parse(inputs.apple_app_identifier.value);
      const bundleVersion = z.string().parse(inputs.bundle_version.value);
      const bundleShortVersion = z.string().parse(inputs.bundle_short_version.value);
      const waitForProcessing = Boolean(inputs.wait_for_processing.value);

      const ipaPath = path.resolve(stepsCtx.workingDirectory, ipaPathInput);
      if (!(await fs.pathExists(ipaPath))) {
        throw new Error(`IPA file not found: ${ipaPath}`);
      }
      const fileSize = (await fs.stat(ipaPath)).size;
      const fileName = path.basename(ipaPath);

      const ascApiKeyPath = path.resolve(stepsCtx.workingDirectory, ascApiKeyPathInput);
      if (!(await fs.pathExists(ascApiKeyPath))) {
        throw new Error(`ASC API Key file not found: ${ascApiKeyPath}`);
      }

      const ascApiKeyJson = await fs.readJson(ascApiKeyPath);
      const ascApiKey = z
        .object({
          issuer_id: z.string(),
          key_id: z.string(),
          key: z.string(),
        })
        .parse(ascApiKeyJson);

      const privateKey = await jose.importPKCS8(ascApiKey.key, 'ES256');
      const token = await new jose.SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: ascApiKey.key_id })
        .setIssuer(ascApiKey.issuer_id)
        .setAudience('appstoreconnect-v1')
        .setExpirationTime('20m')
        .sign(privateKey);

      const client = new AscApiClient({ token, logger: stepsCtx.logger });

      stepsCtx.logger.info(
        `Reading App information for Apple app identifier: ${appleAppIdentifier}...`
      );
      const appResponse = await AscApiUtils.getAppInfoAsync({ client, appleAppIdentifier });
      const ascAppBundleIdentifier = appResponse.data.attributes.bundleId;
      stepsCtx.logger.info(
        `Uploading Build to "${appResponse.data.attributes.name}" (${ascAppBundleIdentifier})...`
      );

      stepsCtx.logger.info('Creating Build Upload...');
      const buildUploadResponse = await AscApiUtils.createBuildUploadAsync({
        client,
        appleAppIdentifier,
        bundleShortVersion,
        bundleVersion,
      });

      const buildUploadId = buildUploadResponse.data.id;
      const buildUploadUrl = `https://appstoreconnect.apple.com/apps/${appleAppIdentifier}/testflight/ios/${buildUploadId}`;
      outputs.build_upload_id.set(buildUploadId);
      outputs.build_upload_url.set(buildUploadUrl);

      stepsCtx.logger.info(
        `Build Upload initialized (ID: ${buildUploadId}). Preparing IPA upload...`
      );
      const buildFileResponse = await client.postAsync('/v1/buildUploadFiles', {
        data: {
          type: 'buildUploadFiles',
          attributes: {
            assetType: 'ASSET',
            fileName,
            fileSize,
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

      stepsCtx.logger.info(
        `IPA Upload initialized (ID: ${buildFileResponse.data.id}). Uploading IPA...`
      );
      await uploadChunksAsync({
        uploadOperations: buildFileResponse.data.attributes.uploadOperations,
        ipaPath,
        logger: stepsCtx.logger,
      });

      stepsCtx.logger.info('Committing upload...');
      await client.patchAsync(
        `/v1/buildUploadFiles/:id`,
        {
          data: {
            type: 'buildUploadFiles',
            id: buildFileResponse.data.id,
            attributes: {
              uploaded: true,
            },
          },
        },
        {
          id: buildFileResponse.data.id,
        }
      );

      stepsCtx.logger.info('Checking upload file status...');
      const waitingForFileStartedAt = Date.now();
      while (Date.now() - waitingForFileStartedAt < 60 * 1000 /* 60 seconds */) {
        const {
          data: {
            attributes: { assetDeliveryState },
          },
        } = await client.getAsync(
          `/v1/buildUploadFiles/:id`,
          { 'fields[buildUploadFiles]': ['assetDeliveryState'] },
          { id: buildFileResponse.data.id }
        );

        if (assetDeliveryState.state === 'AWAITING_UPLOAD') {
          stepsCtx.logger.info(
            `Waiting for file upload to complete processing... (state = ${assetDeliveryState.state})`
          );
          await setTimeout(2000);
          continue;
        }

        const { errors = [], warnings = [] } = assetDeliveryState;
        if (warnings.length > 0) {
          stepsCtx.logger.warn(`Warnings:\n${itemizeMessages(warnings)}\n`);
        }
        if (errors.length > 0) {
          stepsCtx.logger.error(`Errors:\n${itemizeMessages(errors)}\n`);
        }

        if (assetDeliveryState.state === 'FAILED') {
          throw new Error(`File upload (ID: ${buildFileResponse.data.id}) failed.`);
        } else if (
          assetDeliveryState.state === 'COMPLETE' ||
          assetDeliveryState.state === 'UPLOAD_COMPLETE'
        ) {
          stepsCtx.logger.info(`File upload (ID: ${buildFileResponse.data.id}) completed!`);
        }
        break;
      }

      stepsCtx.logger.info(`See your build in App Store Connect: ${buildUploadUrl}`);

      if (!waitForProcessing) {
        stepsCtx.logger.info('Skipping waiting for processing.');
        return;
      }

      stepsCtx.logger.info('Checking build upload status...');
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
            stepsCtx.logger.info(
              `Waiting for build upload to complete... (status = ${state.state})`
            );
            lastWaitLogTime = now;
            lastWaitLogState = state.state;
          }
          await setTimeout(2000);
          continue;
        }

        stepsCtx.logger.info('\n');

        const { errors = [], warnings = [], infos = [] } = state;
        if (infos.length > 0) {
          stepsCtx.logger.info(`Infos:\n${itemizeMessages(infos)}\n`);
        }
        if (warnings.length > 0) {
          stepsCtx.logger.warn(`Warnings:\n${itemizeMessages(warnings)}\n`);
        }
        if (errors.length > 0) {
          stepsCtx.logger.error(`Errors:\n${itemizeMessages(errors)}\n`);
        }

        if (state.state === 'FAILED') {
          if (isInvalidBundleIdentifierError(errors)) {
            const ipaInfoResult = await asyncResult(readIpaInfoAsync(ipaPath));
            const ipaBundleIdentifier = ipaInfoResult.ok
              ? ipaInfoResult.value.bundleIdentifier
              : null;

            throw new UserFacingError(
              'EAS_UPLOAD_TO_ASC_INVALID_BUNDLE_ID',
              `Build upload was rejected by App Store Connect because the app bundle identifier in the IPA does not match the selected App Store Connect app.\n\n` +
                `IPA bundle identifier: ${ipaBundleIdentifier ?? '(unavailable)'}\n` +
                `App Store Connect app bundle identifier: ${ascAppBundleIdentifier}\n\n` +
                'Bundle identifier cannot be changed for an existing App Store Connect app. ' +
                'If you selected the wrong app, change the Apple app identifier in the submit profile. ' +
                'If you selected the right app, you may want to select a different build to upload (or rebuild with a different profile).'
            );
          }
          if (isMissingPurposeStringError(errors)) {
            const missingUsageDescriptionKeys = parseMissingUsageDescriptionKeys(errors);
            throw new UserFacingError(
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
            throw new UserFacingError(
              'EAS_UPLOAD_TO_ASC_CLOSED_VERSION_TRAIN',
              `Build upload was rejected by App Store Connect because the ${bundleShortVersion} app version is not accepted for new build submissions. ` +
                'This usually means the version train is closed or lower than a previously approved version. ' +
                'Bump the iOS app version (CFBundleShortVersionString, e.g. expo.version) to a higher version, then rebuild and submit again.'
            );
          }
          throw new Error(`Build upload (ID: ${buildUploadId}) failed.`);
        } else if (state.state === 'COMPLETE') {
          stepsCtx.logger.info(`Build upload (ID: ${buildUploadId}) complete!`);
        }
        break;
      }
    },
  });
}

function itemizeMessages(messages: { description: string; code: string }[]): string {
  return `- ${messages.map(m => `${m.description} (${m.code})`).join('\n- ')}`;
}

export function isClosedVersionTrainError(messages: { code: string }[]): boolean {
  return (
    messages.length > 0 &&
    messages.every(message => ['90062', '90186', '90478'].includes(message.code))
  );
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

async function uploadChunksAsync({
  uploadOperations,
  ipaPath,
  logger,
}: {
  uploadOperations: AscApiClientPostApi['/v1/buildUploadFiles']['response']['data']['attributes']['uploadOperations'];
  ipaPath: string;
  logger: { info: (message: string) => void };
}): Promise<void> {
  const fd = await fs.open(ipaPath, 'r');
  try {
    const promises = uploadOperations.map(async (op, index) => {
      logger.info(
        `  Uploading chunk ${index + 1}/${uploadOperations.length} (offset: ${op.offset}, length: ${
          op.length
        })...`
      );

      const buffer = new Uint8Array(op.length);
      await fs.read(fd, buffer, 0, op.length, op.offset);

      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
      };

      for (const { name, value } of op.requestHeaders) {
        headers[name] = value;
      }

      const response = await fetch(op.url, {
        method: op.method,
        headers,
        body: buffer,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Failed to upload chunk ${index + 1}: ${response.status} ${response.statusText}\n${text}`
        );
      }
      logger.info(`  Chunk ${index + 1}/${uploadOperations.length} uploaded.`);
    });

    await Promise.all(promises);
  } finally {
    await fs.close(fd);
  }
}
