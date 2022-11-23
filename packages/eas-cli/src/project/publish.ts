import { ExpoConfig, Platform } from '@expo/config';
import JsonFile from '@expo/json-file';
import crypto from 'crypto';
import fs from 'fs-extra';
import Joi from 'joi';
import mime from 'mime';
import path from 'path';
import promiseLimit from 'promise-limit';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AssetMetadataStatus, PartialManifestAsset } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import { PublishQuery } from '../graphql/queries/PublishQuery';
import Log from '../log';
import { PresignedPost, uploadWithPresignedPostWithRetryAsync } from '../uploads';
import { expoCommandAsync, shouldUseVersionedExpoCLI } from '../utils/expoCli';
import chunk from '../utils/expodash/chunk';
import uniqBy from '../utils/expodash/uniqBy';

export type ExpoCLIExportPlatformFlag = Platform | 'all';

type Metadata = {
  version: number;
  bundler: 'metro';
  fileMetadata: {
    [key in Platform]: { assets: { path: string; ext: string }[]; bundle: string };
  };
};
export type RawAsset = {
  fileExtension?: string;
  contentType: string;
  path: string;
};
type CollectedAssets = {
  [platform in Platform]?: {
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
  [key in Platform]: ManifestFragment;
};

const fileMetadataJoi = Joi.object({
  assets: Joi.array()
    .required()
    .items(Joi.object({ path: Joi.string().required(), ext: Joi.string().required() })),
  bundle: Joi.string().required(),
}).optional();
export const MetadataJoi = Joi.object({
  version: Joi.number().required(),
  bundler: Joi.string().required(),
  fileMetadata: Joi.object({
    android: fileMetadataJoi,
    ios: fileMetadataJoi,
    web: fileMetadataJoi,
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
  let platform: Platform;
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
  exp,
  platformFlag,
}: {
  projectDir: string;
  inputDir: string;
  exp: Pick<ExpoConfig, 'sdkVersion'>;
  platformFlag: ExpoCLIExportPlatformFlag;
}): Promise<void> {
  const packageJSON = JsonFile.read(path.resolve(projectDir, 'package.json'));
  if (!packageJSON) {
    throw new Error('Could not locate package.json');
  }

  if (shouldUseVersionedExpoCLI(projectDir, exp)) {
    await expoCommandAsync(projectDir, [
      'export',
      '--output-dir',
      inputDir,
      '--dump-sourcemap',
      '--platform',
      platformFlag,
    ]);
  } else {
    // Legacy global Expo CLI
    await expoCommandAsync(projectDir, [
      'export',
      '--output-dir',
      inputDir,
      '--experimental-bundle',
      '--non-interactive',
      '--dump-sourcemap',
      '--platform',
      platformFlag,
    ]);
  }
}

export async function resolveInputDirectoryAsync(
  inputDir: string,
  { skipBundler }: { skipBundler?: boolean }
): Promise<string> {
  const distRoot = path.resolve(inputDir);
  if (!(await fs.pathExists(distRoot))) {
    let error = `--input-dir="${inputDir}" not found.`;
    if (skipBundler) {
      error += ` --skip-bundler requires the project to be exported manually before uploading. Ex: npx expo export && eas update --skip-bundler`;
    }
    throw new Error(error);
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
  const platforms = Object.keys(metadata.fileMetadata);
  if (platforms.length === 0) {
    Log.warn('No updates were exported for any platform');
  }
  Log.debug(`Loaded ${platforms.length} platform(s): ${platforms.join(', ')}`);
  return metadata;
}

export function filterExportedPlatformsByFlag<T extends Partial<Record<Platform, any>>>(
  record: T,
  platformFlag: ExpoCLIExportPlatformFlag
): T {
  if (platformFlag === 'all') {
    return record;
  }

  const platform = platformFlag as Platform;

  if (!record[platform]) {
    throw new Error(
      `--platform="${platform}" not found in metadata.json. Available platform(s): ${Object.keys(
        record
      ).join(', ')}`
    );
  }

  return { [platform]: record[platform] } as T;
}

/** Given a directory, load the metadata.json and collect the assets for each platform. */
export async function collectAssetsAsync(dir: string): Promise<CollectedAssets> {
  const metadata = loadMetadata(dir);

  const collectedAssets: CollectedAssets = {};

  for (const platform of Object.keys(metadata.fileMetadata) as Platform[]) {
    collectedAssets[platform] = {
      launchAsset: {
        fileExtension: '.bundle',
        contentType: 'application/javascript',
        path: path.resolve(dir, metadata.fileMetadata[platform].bundle),
      },
      assets: metadata.fileMetadata[platform].assets.map(asset => ({
        fileExtension: asset.ext ? ensureLeadingPeriod(asset.ext) : undefined,
        contentType: guessContentTypeFromExtension(asset.ext),
        path: path.join(dir, asset.path),
      })),
    };
  }

  return collectedAssets;
}

// ensure the file extension has a '.' prefix
function ensureLeadingPeriod(extension: string): string {
  return extension.startsWith('.') ? extension : `.${extension}`;
}

export async function filterOutAssetsThatAlreadyExistAsync(
  graphqlClient: ExpoGraphqlClient,
  uniqueAssetsWithStorageKey: (RawAsset & { storageKey: string })[]
): Promise<(RawAsset & { storageKey: string })[]> {
  const assetMetadata = await PublishQuery.getAssetMetadataAsync(
    graphqlClient,
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

type AssetUploadResult = {
  assetCount: number;
  uniqueAssetCount: number;
  uniqueUploadedAssetCount: number;
  assetLimitPerUpdateGroup: number;
};

export async function uploadAssetsAsync(
  graphqlClient: ExpoGraphqlClient,
  assetsForUpdateInfoGroup: CollectedAssets,
  projectId: string,
  updateSpinnerText?: (totalAssets: number, missingAssets: number) => void
): Promise<AssetUploadResult> {
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

  const totalAssets = uniqueAssets.length;

  updateSpinnerText?.(totalAssets, totalAssets);
  let missingAssets = await filterOutAssetsThatAlreadyExistAsync(graphqlClient, uniqueAssets);
  const uniqueUploadedAssetCount = missingAssets.length;

  const missingAssetChunks = chunk(missingAssets, 100);
  const specifications: string[] = [];
  for (const missingAssets of missingAssetChunks) {
    const { specifications: chunkSpecifications } = await PublishMutation.getUploadURLsAsync(
      graphqlClient,
      missingAssets.map(ma => ma.contentType)
    );
    specifications.push(...chunkSpecifications);
  }

  updateSpinnerText?.(totalAssets, missingAssets.length);

  const assetUploadPromiseLimit = promiseLimit(15);

  const [assetLimitPerUpdateGroup] = await Promise.all([
    PublishQuery.getAssetLimitPerUpdateGroupAsync(graphqlClient, projectId),
    missingAssets.map((missingAsset, i) => {
      assetUploadPromiseLimit(async () => {
        const presignedPost: PresignedPost = JSON.parse(specifications[i]);
        await uploadWithPresignedPostWithRetryAsync(missingAsset.path, presignedPost);
      });
    }),
  ]);

  let timeout = 1;
  while (missingAssets.length > 0) {
    const timeoutPromise = new Promise(resolve =>
      setTimeout(resolve, Math.min(timeout * 1000, 5000))
    ); // linear backoff
    missingAssets = await filterOutAssetsThatAlreadyExistAsync(graphqlClient, missingAssets);
    await timeoutPromise; // await after filterOutAssetsThatAlreadyExistAsync for easy mocking with jest.runAllTimers
    timeout += 1;
    updateSpinnerText?.(totalAssets, missingAssets.length);
  }
  return {
    assetCount: assets.length,
    uniqueAssetCount: uniqueAssets.length,
    uniqueUploadedAssetCount,
    assetLimitPerUpdateGroup,
  };
}

export function isUploadedAssetCountAboveWarningThreshold(
  uploadedAssetCount: number,
  assetLimitPerUpdateGroup: number
): boolean {
  const warningThreshold = Math.floor(assetLimitPerUpdateGroup * 0.75);
  return uploadedAssetCount > warningThreshold;
}
