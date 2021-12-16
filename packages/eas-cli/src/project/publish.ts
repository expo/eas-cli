import { ExpoConfig, Platform } from '@expo/config';
import JsonFile from '@expo/json-file';
import crypto from 'crypto';
import fs from 'fs-extra';
import Joi from 'joi';
import mime from 'mime';
import path from 'path';

import { AssetMetadataStatus, PartialManifestAsset } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import { PresignedPost } from '../graphql/mutations/UploadSessionMutation';
import { PublishQuery } from '../graphql/queries/PublishQuery';
import { uploadWithPresignedPostAsync } from '../uploads';
import { expoCommandAsync } from '../utils/expoCli';
import uniqBy from '../utils/expodash/uniqBy';

export const TIMEOUT_LIMIT = 60_000; // 1 minute

export type PublishPlatform = Extract<'android' | 'ios', Platform>;
type Metadata = {
  version: number;
  bundler: 'metro';
  fileMetadata: {
    [key in 'android' | 'ios']: { assets: { path: string; ext: string }[]; bundle: string };
  };
};
export type RawAsset = {
  fileExtension?: string;
  contentType: string;
  path: string;
};
type CollectedAssets = {
  [platform in PublishPlatform]?: {
    launchAsset: RawAsset;
    assets: RawAsset[];
  };
};

type ManifestExtra = {
  expoClient?: { [key: string]: any };
  [key: string]: any;
};
type ManifestFragment = {
  launchAsset: PartialManifestAsset;
  assets: PartialManifestAsset[];
  extra?: ManifestExtra;
};
type UpdateInfoGroup = {
  [key in PublishPlatform]: ManifestFragment;
};

const fileMetadataJoi = Joi.object({
  assets: Joi.array()
    .required()
    .items(Joi.object({ path: Joi.string().required(), ext: Joi.string().required() })),
  bundle: Joi.string().required(),
}).required();
export const MetadataJoi = Joi.object({
  version: Joi.number().required(),
  bundler: Joi.string().required(),
  fileMetadata: Joi.object({
    android: fileMetadataJoi,
    ios: fileMetadataJoi,
  }).required(),
}).required();

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
  const fileSHA256 = getBase64URLEncoding(await calculateFileHashAsync(asset.path, 'sha256'));
  return getStorageKey(asset.contentType, fileSHA256);
}

export async function convertAssetToUpdateInfoGroupFormatAsync(
  asset: RawAsset
): Promise<PartialManifestAsset> {
  const fileSHA256 = getBase64URLEncoding(await calculateFileHashAsync(asset.path, 'sha256'));
  const { contentType, fileExtension } = asset;

  const storageKey = getStorageKey(contentType, fileSHA256);
  const bundleKey = (await calculateFileHashAsync(asset.path, 'md5')).toString('hex');

  return {
    fileSHA256,
    contentType,
    storageKey,
    bundleKey,
    fileExtension,
  };
}

/**
 * This will be sorted later based on the platform's runtime versions.
 */
export async function buildUnsortedUpdateInfoGroupAsync(
  assets: CollectedAssets,
  exp: ExpoConfig
): Promise<UpdateInfoGroup> {
  let platform: PublishPlatform;
  const updateInfoGroup: Partial<UpdateInfoGroup> = {};
  for (platform in assets) {
    updateInfoGroup[platform] = {
      launchAsset: await convertAssetToUpdateInfoGroupFormatAsync(assets[platform]?.launchAsset!),
      assets: await Promise.all(
        (assets[platform]?.assets ?? []).map(convertAssetToUpdateInfoGroupFormatAsync)
      ),
      extra: {
        expoClient: exp,
      },
    };
  }
  return updateInfoGroup as UpdateInfoGroup;
}

export async function buildBundlesAsync({
  projectDir,
  inputDir,
}: {
  projectDir: string;
  inputDir: string;
}): Promise<void> {
  const packageJSON = JsonFile.read(path.resolve(projectDir, 'package.json'));
  if (!packageJSON) {
    throw new Error('Could not locate package.json');
  }

  await expoCommandAsync(
    projectDir,
    ['export', '--output-dir', inputDir, '--experimental-bundle'],
    { silent: true }
  );
}

export async function resolveInputDirectoryAsync(customInputDirectory: string): Promise<string> {
  const distRoot = path.resolve(customInputDirectory);
  if (!(await fs.pathExists(distRoot))) {
    throw new Error(`The input directory "${customInputDirectory}" does not exist.
    You can allow us to build it for you by not setting the --skip-bundler flag.
    If you chose to build it yourself you'll need to run a command to build the JS
    bundle first.
    You can use '--input-dir' to specify a different input directory.`);
  }
  return distRoot;
}

export function loadMetadata(distRoot: string): Metadata {
  const metadata: Metadata = JsonFile.read(path.join(distRoot, 'metadata.json'));
  const { error } = MetadataJoi.validate(metadata);
  if (error) {
    throw error;
  }
  // Check version and bundler by hand (instead of with Joi) so
  // more informative error messages can be returned.
  if (metadata.version !== 0) {
    throw new Error('Only bundles with metadata version 0 are supported');
  }
  if (metadata.bundler !== 'metro') {
    throw new Error('Only bundles created with Metro are currently supported');
  }
  return metadata;
}

export async function collectAssetsAsync({
  inputDir,
  platforms,
}: {
  inputDir: string;
  platforms: PublishPlatform[];
}): Promise<CollectedAssets> {
  const distRoot = await resolveInputDirectoryAsync(inputDir);
  const metadata = loadMetadata(distRoot);

  const assetsFinal: CollectedAssets = {};
  for (const platform of platforms) {
    assetsFinal[platform] = {
      launchAsset: {
        fileExtension: '.bundle',
        contentType: 'application/javascript',
        path: path.resolve(distRoot, metadata.fileMetadata[platform].bundle),
      },
      assets: metadata.fileMetadata[platform].assets.map(asset => {
        let fileExtension;
        if (asset.ext) {
          // ensure the file extension has a '.' prefix
          fileExtension = asset.ext.startsWith('.') ? asset.ext : `.${asset.ext}`;
        }
        return {
          fileExtension,
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

  const assetsWithStorageKey = await Promise.all(
    assets.map(async asset => {
      return {
        ...asset,
        storageKey: await getStorageKeyForAssetAsync(asset),
      };
    })
  );
  const uniqueAssets = uniqBy<
    RawAsset & {
      storageKey: string;
    }
  >(assetsWithStorageKey, asset => asset.storageKey);

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
