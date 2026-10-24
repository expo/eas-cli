import { asyncResult } from '@expo/results';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';

import { AscApiClient, AscApiClientPostApi } from '../utils/ios/AscApiClient';
import { AscApiUtils } from '../utils/ios/AscApiUtils';
import { itemizeMessages, waitForAscBuildProcessingAsync } from '../utils/ios/ascBuildProcessing';
import { readIpaInfoAsync } from './readIpaInfo';

export function createUploadToAscBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'upload_to_asc',
    name: 'Upload to App Store Connect',
    __metricsId: 'eas/upload_to_asc',
    __hookId: 'submit',
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

      const key = await AscApiUtils.loadApiKeyAsync({ keyPath: ascApiKeyPath });
      const client = new AscApiClient({ key, logger: stepsCtx.logger });

      stepsCtx.logger.info(
        `Reading App information for Apple app identifier: ${appleAppIdentifier}...`
      );
      const appResponse = await AscApiUtils.getAppInfoAsync({ client, appleAppIdentifier });
      const ascAppBundleIdentifier = appResponse.data.attributes.bundleId;
      stepsCtx.logger.info(
        `Uploading Build to "${appResponse.data.attributes.name}" (${ascAppBundleIdentifier})...`
      );

      // Derive the App Store Connect platform from the IPA itself so tvOS (and
      // other) binaries are uploaded to the correct version train instead of the
      // iOS one. Falls back to `IOS` if the platform cannot be read.
      const ipaInfoResult = await asyncResult(readIpaInfoAsync(ipaPath));
      const platform = ipaInfoResult.ok
        ? AscApiUtils.ascPlatformFromDtPlatformName(ipaInfoResult.value.dtPlatformName)
        : 'IOS';
      stepsCtx.logger.info(`Detected App Store Connect platform: ${platform}`);

      stepsCtx.logger.info('Creating Build Upload...');
      const buildUploadResponse = await AscApiUtils.createBuildUploadAsync({
        client,
        appleAppIdentifier,
        bundleShortVersion,
        bundleVersion,
        platform,
      });

      const buildUploadId = buildUploadResponse.data.id;
      const platformPathSegment = AscApiUtils.testFlightPlatformPathSegment(platform);
      const buildUploadUrl = `https://appstoreconnect.apple.com/apps/${appleAppIdentifier}/testflight/${platformPathSegment}/${buildUploadId}`;
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
      await AscApiUtils.commitBuildUploadFileAsync({
        client,
        fileId: buildFileResponse.data.id,
        logger: stepsCtx.logger,
      });

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

      await waitForAscBuildProcessingAsync({
        client,
        buildUploadId,
        logger: stepsCtx.logger,
        ipaPath,
        ascAppBundleIdentifier,
        bundleShortVersion,
      });
    },
  });
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
