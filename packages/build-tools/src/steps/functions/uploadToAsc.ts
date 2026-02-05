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

      stepsCtx.logger.info('Reading App information...');
      const appResponse = await client.getAsync(
        '/v1/apps/:id',
        { 'fields[apps]': ['bundleId', 'name'] },
        { id: appleAppIdentifier }
      );
      stepsCtx.logger.info(
        `Uploading Build to "${appResponse.data.attributes.name}" (${appResponse.data.attributes.bundleId})...`
      );

      stepsCtx.logger.info('Creating Build Upload...');
      const buildUploadResponse = await client.postAsync('/v1/buildUploads', {
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
      while (Date.now() - waitingForBuildStartedAt < 10 * 60 * 1000 /* 10 minutes */) {
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
          stepsCtx.logger.info(`Waiting for build upload to complete... (status = ${state.state})`);
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
