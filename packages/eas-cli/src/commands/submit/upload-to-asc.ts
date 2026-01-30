import { Flags } from '@oclif/core';
import fs from 'fs-extra';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import path from 'path';
import { setTimeout } from 'timers/promises';
import { z } from 'zod';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { AscApiClient, AscApiClientPostApi } from '../../submit/ios/AscApiClient';

export default class SubmitUploadToAsc extends EasCommand {
  static override hidden = true;

  static override flags = {
    path: Flags.string({
      description: 'Path to the IPA file',
      required: true,
    }),
    key: Flags.string({
      description: 'Path to the ASC API Key JSON file',
      required: true,
    }),
    'app-id': Flags.string({
      description: 'App Store Connect App ID (e.g. 1491144534)',
      required: true,
    }),
    'bundle-version': Flags.string({
      description: 'CFBundleVersion (Build Version, e.g. 13)',
      required: true,
    }),
    'bundle-short-version': Flags.string({
      description: 'CFBundleShortVersionString (Marketing Version, e.g. 1.0.0)',
      required: true,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SubmitUploadToAsc);

    const ipaPath = path.resolve(flags.path);
    if (!(await fs.pathExists(ipaPath))) {
      throw new Error(`IPA file not found: ${ipaPath}`);
    }
    const fileSize = (await fs.stat(ipaPath)).size;
    const fileName = path.basename(ipaPath);

    const keyPath = path.resolve(flags.key);
    if (!(await fs.pathExists(keyPath))) {
      throw new Error(`Key file not found: ${keyPath}`);
    }

    const keyJson = await fs.readJson(keyPath);
    const apiKey = z
      .object({
        issuer_id: z.string(),
        key_id: z.string(),
        key: z.string(),
      })
      .parse(keyJson);

    Log.log('Generating JWT...');
    const token = jwt.sign({}, apiKey.key, {
      algorithm: 'ES256',
      issuer: apiKey.issuer_id,
      expiresIn: '20m',
      audience: 'appstoreconnect-v1',
      header: {
        kid: apiKey.key_id,
      },
    });

    const client = new AscApiClient({ token });

    Log.log('Reading App information...');
    const appResponse = await client.getAsync(
      '/v1/apps/:id',
      { 'fields[apps]': ['bundleId', 'name'] as const },
      { id: flags['app-id'] }
    );
    Log.log(
      `Uploading Build to "${appResponse.data.attributes.name}" (${appResponse.data.attributes.bundleId})...`
    );

    Log.log('Creating Build Upload...');
    const buildUploadResponse = await client.postAsync('/v1/buildUploads', {
      data: {
        type: 'buildUploads',
        attributes: {
          platform: 'IOS',
          cfBundleShortVersionString: flags['bundle-short-version'],
          cfBundleVersion: flags['bundle-version'],
        },
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: flags['app-id'],
            },
          },
        },
      },
    });

    const buildUploadId = buildUploadResponse.data.id;

    Log.log(`Build Upload initialized (ID: ${buildUploadId}). Preparing IPA upload...`);
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

    Log.log(`IPA Upload initialized (ID: ${buildFileResponse.data.id}). Uploading IPA...`);
    await uploadChunksAsync({
      uploadOperations: buildFileResponse.data.attributes.uploadOperations,
      ipaPath,
    });

    Log.log('Committing upload...');
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

    Log.log('Checking upload file status...');
    const waitingForFileStartedAt = performance.now();
    while (performance.now() - waitingForFileStartedAt < 60 * 1000 /* 60 seconds */) {
      const buildFileStatusResponse = await client.getAsync(
        `/v1/buildUploadFiles/:id`,
        { 'fields[buildUploadFiles]': ['assetDeliveryState'] },
        { id: buildFileResponse.data.id }
      );

      if (buildFileStatusResponse.data.attributes.assetDeliveryState.state === 'AWAITING_UPLOAD') {
        Log.log(
          `Waiting for file upload to finish processing... (state = ${buildFileStatusResponse.data.attributes.assetDeliveryState.state})`
        );
        await setTimeout(2000);
        continue;
      }

      const { errors = [], warnings = [] } =
        buildFileStatusResponse.data.attributes.assetDeliveryState;
      if (warnings.length > 0) {
        Log.warn(
          `Warnings:\n- ${warnings.map(w => `${w.description} (${w.code})`).join('\n- ')}\n`
        );
      }
      if (errors.length > 0) {
        Log.error(`Errors:\n- ${errors.map(e => `${e.description} (${e.code})`).join('\n- ')}\n`);
      }

      if (buildFileStatusResponse.data.attributes.assetDeliveryState.state === 'FAILED') {
        throw new Error(`File upload (ID: ${buildFileResponse.data.id}) failed.`);
      } else if (buildFileStatusResponse.data.attributes.assetDeliveryState.state === 'COMPLETE') {
        Log.log(`File upload (ID: ${buildFileResponse.data.id}) complete!`);
      } else if (
        buildFileStatusResponse.data.attributes.assetDeliveryState.state === 'UPLOAD_COMPLETE'
      ) {
        Log.log(`File upload (ID: ${buildFileResponse.data.id}) finished!`);
      }
      break;
    }

    Log.log('Checking build upload status...');
    const waitingForBuildStartedAt = performance.now();
    while (performance.now() - waitingForBuildStartedAt < 60 * 1000 /* 60 seconds */) {
      const buildUploadStatusResponse = await client.getAsync(
        `/v1/buildUploads/:id`,
        { 'fields[buildUploads]': ['state', 'build'], include: ['build'] },
        { id: buildUploadId }
      );

      if (
        buildUploadStatusResponse.data.attributes.state.state === 'AWAITING_UPLOAD' ||
        buildUploadStatusResponse.data.attributes.state.state === 'PROCESSING'
      ) {
        Log.log(
          `Waiting for build upload to finish... (status = ${buildUploadStatusResponse.data.attributes.state.state})`
        );
        await setTimeout(2000);
        continue;
      }

      Log.log('\n');

      const {
        errors = [],
        warnings = [],
        infos = [],
      } = buildUploadStatusResponse.data.attributes.state;
      if (infos.length > 0) {
        Log.log(`Infos:\n- ${infos.map(i => `${i.description} (${i.code})`).join('\n- ')}\n`);
      }
      if (warnings.length > 0) {
        Log.warn(
          `Warnings:\n- ${warnings.map(w => `${w.description} (${w.code})`).join('\n- ')}\n`
        );
      }
      if (errors.length > 0) {
        Log.error(`Errors:\n- ${errors.map(e => `${e.description} (${e.code})`).join('\n- ')}\n`);
      }

      if (buildUploadStatusResponse.data.attributes.state.state === 'FAILED') {
        throw new Error(`Build upload (ID: ${buildUploadId}) failed.`);
      } else if (buildUploadStatusResponse.data.attributes.state.state === 'COMPLETE') {
        Log.log(`Build upload (ID: ${buildUploadId}) complete!`);
      }
      break;
    }
  }
}

async function uploadChunksAsync({
  uploadOperations,
  ipaPath,
}: {
  uploadOperations: AscApiClientPostApi['/v1/buildUploadFiles']['response']['data']['attributes']['uploadOperations'];
  ipaPath: string;
}): Promise<void> {
  const fd = await fs.open(ipaPath, 'r');
  try {
    const promises = uploadOperations.map(async (op, index) => {
      Log.log(
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
      Log.log(`  Chunk ${index + 1}/${uploadOperations.length} uploaded.`);
    });

    await Promise.all(promises);
  } finally {
    await fs.close(fd);
  }
}
