import { Platform } from '@expo/config';
import JsonFile from '@expo/json-file';
import crypto from 'crypto';
import fs from 'fs';
import { uniqBy } from 'lodash';
import mime from 'mime';
import path from 'path';

import { AssetMetadataStatus, PartialManifestAsset } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import { PublishQuery } from '../graphql/queries/PublishQuery';
import { PresignedPost, uploadWithPresignedPostAsync } from '../uploads';

export const TIMEOUT_LIMIT = 60_000; // 1 minute
const STORAGE_BUCKET = getStorageBucket();
export const Platforms: PublishPlatform[] = ['android', 'ios']; // TODO-JJ allow users to specify this in app.js

function getStorageBucket(): string {
  if (process.env.EXPO_STAGING || process.env.EXPO_LOCAL) {
    return 'update-assets-staging';
  } else {
    return 'update-assets-production';
  }
}

export type PublishPlatform = Extract<'android' | 'ios', Platform>;
type Metadata = {
  version: number;
  bundler: 'metro';
  fileMetadata: {
    [key in 'android' | 'ios']: { assets: { path: string; ext: string }[]; bundle: string };
  };
};
export type RawAsset = {
  type: string;
  contentType: string;
  path: string;
};
type CollectedAssets = {
  [platform in PublishPlatform]?: {
    launchAsset: RawAsset;
    assets: RawAsset[];
  };
};

type ManifestFragment = {
  launchAsset: PartialManifestAsset;
  assets: PartialManifestAsset[];
};
type UpdateInfoGroup = {
  [key in PublishPlatform]: ManifestFragment;
};

export function guessContentTypeFromExtension(ext?: string): string {
  return mime.getType(ext ?? '') ?? 'application/octet-stream'; // unrecognized extension
}

export function getBase64URLEncoding(buffer: Buffer): string {
  const base64 = buffer.toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The storage key is used to store the asset in GCS
 */
export function getStorageKey(contentType: string, contentHash: string): string {
  const nullSeparator = Buffer.alloc(1);
  const hash = crypto
    .createHash('sha256')
    .update(contentType)
    .update(nullSeparator)
    .update(contentHash)
    .digest();
  return getBase64URLEncoding(hash);
}

async function calculateFileHashAsync(filePath: string, algorithm: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const file = fs.createReadStream(filePath).on('error', reject);
    const hash = file.pipe(crypto.createHash(algorithm)).on('error', reject);
    hash.on('finish', () => resolve(hash.read()));
  });
}

/**
 * Convenience function that computes an assets storage key starting from its buffer.
 */
export async function getStorageKeyForAssetAsync(asset: RawAsset): Promise<string> {
  const fileHash = getBase64URLEncoding(await calculateFileHashAsync(asset.path, 'sha256'));
  return getStorageKey(asset.contentType, fileHash);
}

export async function convertAssetToUpdateInfoGroupFormatAsync(
  asset: RawAsset
): Promise<PartialManifestAsset> {
  const fileHash = getBase64URLEncoding(await calculateFileHashAsync(asset.path, 'sha256'));
  const contentType = asset.contentType;
  const storageKey = getStorageKey(contentType, fileHash);
  const bundleKey = [
    (await calculateFileHashAsync(asset.path, 'md5')).toString('hex'),
    asset.type,
  ].join('.');

  return {
    fileHash,
    contentType,
    storageBucket: STORAGE_BUCKET,
    storageKey,
    bundleKey,
  };
}

export async function buildUpdateInfoGroupAsync(assets: CollectedAssets): Promise<UpdateInfoGroup> {
  let platform: PublishPlatform;
  const updateInfoGroup: Partial<UpdateInfoGroup> = {};
  for (platform in assets) {
    updateInfoGroup[platform] = {
      launchAsset: await convertAssetToUpdateInfoGroupFormatAsync(assets[platform]?.launchAsset!),
      assets: await Promise.all(
        (assets[platform]?.assets ?? []).map(convertAssetToUpdateInfoGroupFormatAsync)
      ),
    };
  }
  return updateInfoGroup as UpdateInfoGroup;
}

export function resolveInputDirectory(customInputDirectory: string): string {
  const distRoot = path.resolve(customInputDirectory);
  if (!fs.existsSync(distRoot)) {
    throw new Error(`The input directory "${customInputDirectory}" does not exist.
    You'll need to run a command to build the JS bundle first (e.g. 'expo export').
    You can use '--input-dir' to specify a different input directory.`);
  }
  return distRoot;
}

export function loadMetadata(distRoot: string): Metadata {
  const metadata: Metadata = JsonFile.read(path.join(distRoot, 'metadata.json'));
  if (metadata.version !== 0) {
    throw new Error('Only bundles with storage version 0 are supported');
  }
  if (metadata.bundler !== 'metro') {
    throw new Error('Only bundles created by metro are supported');
  }
  return metadata;
}

export function collectAssets(inputDir: string): CollectedAssets {
  const distRoot = resolveInputDirectory(inputDir);
  const metadata = loadMetadata(distRoot);

  const assetsFinal: CollectedAssets = {};
  for (const platform of Platforms) {
    assetsFinal[platform] = {
      launchAsset: {
        type: 'bundle',
        contentType: 'application/javascript',
        path: path.resolve(distRoot, metadata.fileMetadata[platform].bundle),
      },
      assets: metadata.fileMetadata[platform].assets.map(asset => {
        return {
          type: asset.ext,
          contentType: guessContentTypeFromExtension(asset.ext),
          path: path.join(distRoot, asset.path),
        };
      }),
    };
  }

  return assetsFinal;
}

export async function filterOutAssetsThatAlreadyExistAsync(
  uniqueAssetsWithStorageKey: (RawAsset & { storageKey: string })[]
): Promise<(RawAsset & { storageKey: string })[]> {
  const assetMetadata = await PublishQuery.getAssetMetadataAsync(
    uniqueAssetsWithStorageKey.map(asset => asset.storageKey)
  );
  const missingAssetKeys = assetMetadata
    .filter(result => result.status !== AssetMetadataStatus.Exists)
    .map(result => result.storageKey);

  const missingAssets = uniqueAssetsWithStorageKey.filter(asset => {
    return missingAssetKeys.includes(asset.storageKey);
  });
  return missingAssets;
}

export async function uploadAssetsAsync(assetsForUpdateInfoGroup: CollectedAssets): Promise<void> {
  let assets: RawAsset[] = [];
  let platform: keyof CollectedAssets;
  for (platform in assetsForUpdateInfoGroup) {
    assets = [
      ...assets,
      assetsForUpdateInfoGroup[platform]!.launchAsset,
      ...assetsForUpdateInfoGroup[platform]!.assets,
    ];
  }

  const uniqueAssets = uniqBy<
    RawAsset & {
      storageKey: string;
    }
  >(
    await Promise.all(
      assets.map(async asset => {
        return {
          ...asset,
          storageKey: await getStorageKeyForAssetAsync(asset),
        };
      })
    ),
    'storageKey'
  );

  let missingAssets = await filterOutAssetsThatAlreadyExistAsync(uniqueAssets);
  const { specifications } = await PublishMutation.getUploadURLsAsync(
    missingAssets.map(ma => ma.contentType)
  );

  await Promise.all(
    missingAssets.map((missingAsset, i) => {
      const presignedPost: PresignedPost = JSON.parse(specifications[i]);
      return uploadWithPresignedPostAsync(fs.createReadStream(missingAsset.path), presignedPost);
    })
  );

  // Wait up to TIMEOUT_LIMIT for assets to be uploaded and processed
  const start = Date.now();
  let timeout = 1;
  while (missingAssets.length > 0) {
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, timeout * 1000)); // linear backoff
    missingAssets = await filterOutAssetsThatAlreadyExistAsync(missingAssets);
    await timeoutPromise; // await after filterOutAssetsThatAlreadyExistAsync for easy mocking with jest.runAllTimers
    timeout += 1;

    if (Date.now() - start > TIMEOUT_LIMIT) {
      throw new Error('Asset upload timed out. Please try again.');
    }
  }
}
