import { ExpoConfig, Platform } from '@expo/config';
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import JsonFile from '@expo/json-file';
import crypto from 'crypto';
import fs from 'fs-extra';
import Joi from 'joi';
import mime from 'mime';
import minimatch from 'minimatch';
import nullthrows from 'nullthrows';
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
import { truthy } from '../utils/expodash/filter';
import mapMap from '../utils/expodash/mapMap';
import mapMapAsync from '../utils/expodash/mapMapAsync';
import partition from '../utils/expodash/partition';
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
  /** Original asset path derrived from asset map, or exported folder */
  originalPath?: string;
};

export type CollectedAssets = Map<
  Platform,
  {
    launchAsset: RawAsset;
    assets: RawAsset[];
  }
>;

type ExcludedAssets = RawAsset[];

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

// Partial copy of `@expo/dev-server` `BundleAssetWithFileHashes`
type AssetMap = Record<
  string,
  {
    httpServerLocation: string;
    name: string;
    type: string;
  }
>;

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
  return Object.fromEntries(
    (
      await mapMapAsync(assets, async (collectedAssets): Promise<ManifestFragment> => {
        return {
          launchAsset: await convertAssetToUpdateInfoGroupFormatAsync(collectedAssets.launchAsset),
          assets: await Promise.all(
            collectedAssets.assets.map(convertAssetToUpdateInfoGroupFormatAsync)
          ),
          extra: {
            expoClient: exp,
          },
        };
      })
    ).entries()
  ) as UpdateInfoGroup;
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
      '--dump-assetmap',
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
      '--dump-assetmap',
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

export function filterExportedPlatformsByFlag<V>(
  record: Map<Platform, V>,
  platformFlag: ExpoCLIExportPlatformFlag
): Map<Platform, V> {
  if (platformFlag === 'all') {
    return record;
  }

  const platform = platformFlag as Platform;

  if (!record.has(platform)) {
    throw new Error(
      `--platform="${platform}" not found in metadata.json. Available platform(s): ${Array.from(
        record.keys()
      ).join(', ')}`
    );
  }

  return new Map([[platform, nullthrows(record.get(platform))]]);
}

/** Try to load the asset map for logging the names of assets published */
export async function loadAssetMapAsync(distRoot: string): Promise<AssetMap | null> {
  const assetMapPath = path.join(distRoot, 'assetmap.json');

  if (!(await fs.pathExists(assetMapPath))) {
    return null;
  }

  const assetMap: AssetMap = JsonFile.read(path.join(distRoot, 'assetmap.json'));
  // TODO: basic validation?
  return assetMap;
}

// exposed for testing
export function getAssetHashFromPath(assetPath: string): string | null {
  const [, hash] = assetPath.match(new RegExp(/assets\/([a-z0-9]+)$/, 'i')) ?? [];
  return hash ?? null;
}

// exposed for testing
export function getOriginalPathFromAssetMap(
  assetMap: AssetMap | null,
  asset: { path: string; ext: string }
): string | null {
  if (!assetMap) {
    return null;
  }
  const assetHash = getAssetHashFromPath(asset.path);
  const assetMapEntry = assetHash && assetMap[assetHash];

  if (!assetMapEntry) {
    return null;
  }

  const pathPrefix = assetMapEntry.httpServerLocation.substring('/assets'.length);
  return `${pathPrefix}/${assetMapEntry.name}.${assetMapEntry.type}`;
}

/** Given a directory, load the metadata.json and collect the assets for each platform. */
export async function collectAssetsAsync(
  projectDir: string,
  distRoot: string
): Promise<{ collectedAssets: CollectedAssets; excludedAssets: ExcludedAssets }> {
  const metadata = loadMetadata(distRoot);
  const assetmap = await loadAssetMapAsync(distRoot);

  const easJsonAccessor = new EasJsonAccessor(projectDir);
  const updatesConfig = await EasJsonUtils.getUpdatesConfigAsync(easJsonAccessor);
  const assetExcludePatterns = updatesConfig?.assetExcludePatterns;

  const platformToAssets = new Map(
    (Object.keys(metadata.fileMetadata) as Platform[]).map(platform => [
      platform,
      metadata.fileMetadata[platform].assets,
    ])
  );

  const platformToIncludedAndExcludedAssets = mapMap(platformToAssets, assets => {
    if (!assetExcludePatterns) {
      return {
        includedAssets: assets,
        excludedAssets: [],
      };
    }

    const [includedAssets, excludedAssets] = partition(assets, asset => {
      const originalPath = getOriginalPathFromAssetMap(assetmap, asset) ?? undefined;
      return (
        !originalPath || !assetExcludePatterns.some(pattern => minimatch(originalPath, pattern))
      );
    });

    return {
      includedAssets,
      excludedAssets,
    };
  });

  const transformAsset = (asset: { path: string; ext: string }): RawAsset => {
    return {
      fileExtension: asset.ext ? ensureLeadingPeriod(asset.ext) : undefined,
      originalPath: getOriginalPathFromAssetMap(assetmap, asset) ?? undefined,
      contentType: guessContentTypeFromExtension(asset.ext),
      path: path.join(distRoot, asset.path),
    };
  };

  const collectedAssets = mapMap(
    platformToIncludedAndExcludedAssets,
    ({ includedAssets }, platform) => {
      return {
        launchAsset: {
          fileExtension: '.bundle',
          contentType: 'application/javascript',
          path: path.resolve(distRoot, metadata.fileMetadata[platform].bundle),
        },
        assets: includedAssets.map(transformAsset),
      };
    }
  );
  const excludedAssets = uniqBy(
    Array.from(
      mapMap(platformToIncludedAndExcludedAssets, ({ excludedAssets }) =>
        excludedAssets.map(transformAsset)
      ).values()
    ).flat(),
    rawAsset => rawAsset.path
  );

  return { collectedAssets, excludedAssets };
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
  /** All found assets within the exported folder per platform */
  assetCount: number;
  /** The uploaded JS bundles, per platform */
  launchAssetCount: number;
  /** All unique assets within the exported folder with platforms combined */
  uniqueAssetCount: number;
  /** All unique assets uploaded  */
  uniqueUploadedAssetCount: number;
  /** All (non-launch) asset original paths, used for logging */
  uniqueUploadedAssetPaths: string[];
  /** The asset limit received from the server */
  assetLimitPerUpdateGroup: number;
};

export async function uploadAssetsAsync(
  graphqlClient: ExpoGraphqlClient,
  assetsForUpdateInfoGroup: CollectedAssets,
  projectId: string,
  updateSpinnerText?: (totalAssets: number, missingAssets: number) => void
): Promise<AssetUploadResult> {
  let assets: RawAsset[] = [];
  const launchAssets: RawAsset[] = [];
  mapMap(assetsForUpdateInfoGroup, collectedAssets => {
    launchAssets.push(collectedAssets.launchAsset);
    assets = [...assets, collectedAssets.launchAsset, ...collectedAssets.assets];
  });

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
  const uniqueUploadedAssetPaths = missingAssets.map(asset => asset.originalPath).filter(truthy);

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
    launchAssetCount: launchAssets.length,
    uniqueAssetCount: uniqueAssets.length,
    uniqueUploadedAssetCount,
    uniqueUploadedAssetPaths,
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
