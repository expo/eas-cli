import { Platform } from '@expo/config';
import JsonFile from '@expo/json-file';
import crypto from 'crypto';
import fs from 'fs';
import { uniqBy } from 'lodash';
import mime from 'mime';
import path from 'path';

import { PartialManifestAsset } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import { PublishQuery } from '../graphql/queries/PublishQuery';
import { PresignedPost, uploadWithPresignedPostAsync } from '../uploads';

export const TIMEOUT_LIMIT = 60_000; // 1 minute
const STORAGE_BUCKET = getStorageBucket();
export const Platforms: PublishPlatforms[] = ['android', 'ios']; // TODO-JJ allow users to specify this in app.js

function getStorageBucket(): string {
  if (process.env.NODE_ENV === 'test') {
    return 'update-assets-testing';
  } else if (process.env.EXPO_STAGING || process.env.EXPO_LOCAL) {
    return 'update-assets-staging';
  } else {
    return 'update-assets-production';
  }
}

export type PublishPlatforms = Extract<'android' | 'ios', Platform>;
export type RawAsset = {
  type: string;
  contentType: string;
  buffer: Buffer;
};
type CollectedAssets = {
  [platform in PublishPlatforms]?: {
    launchAsset: RawAsset;
    assets: RawAsset[];
  };
};

type ManifestFragment = {
  launchAsset: PartialManifestAsset;
  assets: PartialManifestAsset[];
};
type UpdateInfoGroup = {
  [key in PublishPlatforms]: ManifestFragment;
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

/**
 * Convenience function that computes an assets storage key starting from its buffer.
 */
export function getStorageKeyForAsset(asset: RawAsset): string {
  const fileHash = getBase64URLEncoding(
    crypto.createHash('sha256').update(asset['buffer']).digest()
  );
  return getStorageKey(asset.contentType, fileHash);
}

export function convertAssetToUpdateInfoGroupFormat(asset: RawAsset): PartialManifestAsset {
  const fileHash = getBase64URLEncoding(
    crypto.createHash('sha256').update(asset['buffer']).digest()
  );
  const contentType = asset['contentType'];
  const storageKey = getStorageKey(contentType, fileHash);
  const bundleKey = [
    crypto.createHash('md5').update(asset['buffer']).digest('hex'),
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

export function buildUpdateInfoGroup(assets: CollectedAssets): UpdateInfoGroup {
  let platform: PublishPlatforms;
  const updateInfoGroup: Partial<UpdateInfoGroup> = {};
  for (platform in assets) {
    updateInfoGroup[platform] = {
      launchAsset: convertAssetToUpdateInfoGroupFormat(assets[platform]?.launchAsset!),
      assets: (assets[platform]?.assets ?? []).map(convertAssetToUpdateInfoGroupFormat),
    };
  }
  return updateInfoGroup as UpdateInfoGroup;
}

export function resolveInputDirectory(customDist: string): string {
  const projectRoot = process.cwd();
  const distRoot = path.join(projectRoot, customDist);
  if (!fs.existsSync(distRoot)) {
    throw new Error(`${distRoot} does not exist. Please create it with your desired bundler.`);
  }
  return distRoot;
}

export function collectUserDefinedAssets(distRoot: string): RawAsset[] {
  const assetRoot = path.join(distRoot, 'assets');
  const assetPointers = Platforms.map(platform => {
    const assetJsonPath = path.join(distRoot, `${platform}-index.json`);
    return JsonFile.read(assetJsonPath).bundledAssets;
  }).flat();

  return [...new Set(assetPointers)].map(pointer => {
    const [filename, ext] = new String(pointer ?? '').split('_').pop()?.split('.') ?? [];
    if (!filename) {
      throw new Error(
        'There was an error locating all of the bundler defined assets. Please rerun the bundler and then retry publishing.'
      );
    }
    return {
      type: ext ?? '',
      contentType: guessContentTypeFromExtension(ext),
      buffer: fs.readFileSync(path.join(assetRoot, filename)),
    };
  });
}

export function collectBundles(distRoot: string): { [key: string]: RawAsset } {
  const bundleRoot = path.join(distRoot, 'bundles');
  const bundlePaths = Object.fromEntries(
    fs.readdirSync(bundleRoot).map(name => [name.split('-')[0], path.join(bundleRoot, name)])
  );

  const bundleBuffers: { [key: string]: RawAsset } = {};
  Platforms.forEach(platform => {
    bundleBuffers[platform] = {
      type: 'bundle',
      contentType: 'application/javascript',
      buffer: fs.readFileSync(bundlePaths[platform]),
    };
  });
  return bundleBuffers;
}

export function collectAssets(inputDir: string): CollectedAssets {
  const distRoot = resolveInputDirectory(inputDir);
  const assets = collectUserDefinedAssets(distRoot);
  const bundles = collectBundles(distRoot);
  const assetsFinal: CollectedAssets = {};

  let platform: PublishPlatforms;
  for (platform of Platforms) {
    assetsFinal[platform] = {
      launchAsset: bundles[platform],
      assets,
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
    .filter(result => result.status !== 'EXISTS')
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
    assets.map(asset => {
      return {
        ...asset,
        storageKey: getStorageKeyForAsset(asset),
      };
    }),
    'storageKey'
  );

  let missingAssets = await filterOutAssetsThatAlreadyExistAsync(uniqueAssets);
  const { specifications } = await PublishMutation.getUploadURLsAsync(
    missingAssets.map(ma => ma.contentType)
  );

  await Promise.all(
    missingAssets.map((missingAsset, i) => {
      const presignedPost: PresignedPost = JSON.parse(specifications[i]);
      return uploadWithPresignedPostAsync(missingAsset.buffer, presignedPost);
    })
  );

  // Wait up to TIMEOUT_LIMIT for assets to be uploaded and processed
  const start = Date.now();
  let slope = 0;
  while (missingAssets.length > 0) {
    if (process.env.NODE_ENV !== 'test') {
      const timeout = slope * 1000; // linear backoff
      await new Promise(resolve => setTimeout(resolve, timeout));
      slope += 1;
    }
    missingAssets = await filterOutAssetsThatAlreadyExistAsync(missingAssets);

    if (Date.now() - start > TIMEOUT_LIMIT) {
      throw new Error('Asset upload timed out. Please try again.');
    }
  }
}
