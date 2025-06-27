import { ExpoConfig, Platform as ExpoConfigPlatform } from '@expo/config';
import { Updates } from '@expo/config-plugins';
import { Env, FingerprintSource, Platform, Workflow } from '@expo/eas-build-job';
import JsonFile from '@expo/json-file';
import assert from 'assert';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs-extra';
import Joi from 'joi';
import mime from 'mime';
import nullthrows from 'nullthrows';
import path from 'path';
import promiseLimit from 'promise-limit';

import { maybeUploadFingerprintAsync } from './maybeUploadFingerprintAsync';
import { isModernExpoUpdatesCLIWithRuntimeVersionCommandSupportedAsync } from './projectUtils';
import { resolveRuntimeVersionUsingCLIAsync } from './resolveRuntimeVersionAsync';
import { selectBranchOnAppAsync } from '../branch/queries';
import { getDefaultBranchNameAsync } from '../branch/utils';
import { fetchBuildsAsync } from '../commandUtils/builds';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { FingerprintOptions, createFingerprintsByKeyAsync } from '../fingerprint/cli';
import {
  AppPlatform,
  AssetMetadataStatus,
  BuildFragment,
  PartialManifestAsset,
  UpdateRolloutInfo,
  UpdateRolloutInfoGroup,
} from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import { BranchQuery } from '../graphql/queries/BranchQuery';
import { PublishQuery } from '../graphql/queries/PublishQuery';
import Log, { learnMore } from '../log';
import { RequestedPlatform, requestedPlatformDisplayNames } from '../platform';
import { promptAsync } from '../prompts';
import { getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync } from '../update/getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync';
import {
  UpdateJsonInfo,
  formatUpdateMessage,
  truncateString as truncateUpdateMessage,
} from '../update/utils';
import { PresignedPost, uploadWithPresignedPostWithRetryAsync } from '../uploads';
import {
  expoCommandAsync,
  shouldUseVersionedExpoCLI,
  shouldUseVersionedExpoCLIWithExplicitPlatforms,
} from '../utils/expoCli';
import { ExpoUpdatesCLIModuleNotFoundError } from '../utils/expoUpdatesCli';
import chunk from '../utils/expodash/chunk';
import { truthy } from '../utils/expodash/filter';
import groupBy from '../utils/expodash/groupBy';
import mapMapAsync from '../utils/expodash/mapMapAsync';
import uniqBy from '../utils/expodash/uniqBy';
import { Client } from '../vcs/vcs';

// update publish does not currently support web
export type UpdatePublishPlatform = 'ios' | 'android';

type Metadata = {
  version: number;
  bundler: 'metro';
  fileMetadata: {
    [key in ExpoConfigPlatform]: { assets: { path: string; ext: string }[]; bundle: string };
  };
};
export type RawAsset = {
  fileExtension?: string;
  contentType: string;
  path: string;
  /** Original asset path derrived from asset map, or exported folder */
  originalPath?: string;
};

type CollectedAssets = {
  [platform in ExpoConfigPlatform]?: {
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
  [key in UpdatePublishPlatform]: ManifestFragment;
};

// Partial copy of `@expo/dev-server` `BundleAssetWithFileHashes`
export type AssetMap = Record<
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
  return await new Promise((resolve, reject) => {
    const file = fs.createReadStream(filePath).on('error', reject);
    const hash = file.pipe(crypto.createHash(algorithm)).on('error', reject);
    hash.on('finish', () => {
      resolve(hash.read());
    });
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
  assets: FilteredCollectedAssets,
  exp: ExpoConfig
): Promise<Partial<UpdateInfoGroup>> {
  let platform: 'ios' | 'android';
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
  return updateInfoGroup;
}

export type ExpoCLIExportPlatformFlag = ExpoConfigPlatform | 'all';

export async function buildBundlesAsync({
  projectDir,
  inputDir,
  exp,
  platformFlag,
  clearCache,
  extraEnv,
}: {
  projectDir: string;
  inputDir: string;
  exp: Pick<ExpoConfig, 'sdkVersion' | 'web'>;
  platformFlag: ExpoCLIExportPlatformFlag;
  clearCache?: boolean;
  extraEnv?: Record<string, string | undefined> | undefined;
}): Promise<void> {
  const packageJSON = JsonFile.read(path.resolve(projectDir, 'package.json'));
  if (!packageJSON) {
    throw new Error('Could not locate package.json');
  }

  // Legacy global Expo CLI
  if (!shouldUseVersionedExpoCLI(projectDir, exp)) {
    await expoCommandAsync(
      projectDir,
      [
        'export',
        '--output-dir',
        inputDir,
        '--experimental-bundle',
        '--non-interactive',
        '--dump-sourcemap',
        '--dump-assetmap',
        `--platform=${platformFlag}`,
        ...(clearCache ? ['--clear'] : []),
      ],
      {
        extraEnv,
      }
    );
    return;
  }

  // Versioned Expo CLI, with multiple platform flag support
  if (shouldUseVersionedExpoCLIWithExplicitPlatforms(projectDir)) {
    // When creating EAS updates, we don't want to build a web bundle
    const platformArgs =
      platformFlag === 'all'
        ? ['--platform', 'ios', '--platform', 'android']
        : ['--platform', platformFlag];

    await expoCommandAsync(
      projectDir,
      [
        'export',
        '--output-dir',
        inputDir,
        '--dump-sourcemap',
        '--dump-assetmap',
        ...platformArgs,
        ...(clearCache ? ['--clear'] : []),
      ],
      {
        extraEnv,
      }
    );
    return;
  }

  // Versioned Expo CLI, without multiple platform flag support
  // Warn users about potential export issues when using Metro web
  // See: https://github.com/expo/expo/pull/23621
  if (exp.web?.bundler === 'metro') {
    Log.warn('Exporting bundle for all platforms, including Metro web.');
    Log.warn(
      'If your app is incompatible with web, remove the "expo.web.bundler" property from your app manifest, or upgrade to the latest Expo SDK.'
    );
  }

  await expoCommandAsync(
    projectDir,
    [
      'export',
      '--output-dir',
      inputDir,
      '--dump-sourcemap',
      '--dump-assetmap',
      `--platform=${platformFlag}`,
      ...(clearCache ? ['--clear'] : []),
    ],
    {
      extraEnv,
    }
  );
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

export async function generateEasMetadataAsync(
  distRoot: string,
  metadata: UpdateJsonInfo[]
): Promise<void> {
  const easMetadataPath = path.join(distRoot, 'eas-update-metadata.json');
  await JsonFile.writeAsync(easMetadataPath, { updates: metadata });
}

export type FilteredCollectedAssets = {
  [RequestedPlatform.Ios]?: NonNullable<CollectedAssets['ios']>;
  [RequestedPlatform.Android]?: NonNullable<CollectedAssets['android']>;
};

export function filterCollectedAssetsByRequestedPlatforms(
  collectedAssets: CollectedAssets,
  requestedPlatform: RequestedPlatform
): FilteredCollectedAssets {
  if (requestedPlatform === RequestedPlatform.All) {
    return {
      ...('ios' in collectedAssets ? { [RequestedPlatform.Ios]: collectedAssets['ios'] } : {}),
      ...('android' in collectedAssets
        ? { [RequestedPlatform.Android]: collectedAssets['android'] }
        : {}),
    };
  }

  const collectedAssetsKey = requestedPlatform === RequestedPlatform.Android ? 'android' : 'ios';
  if (!collectedAssets[collectedAssetsKey]) {
    throw new Error(
      `--platform="${collectedAssetsKey}" not found in metadata.json. Available platform(s): ${Object.keys(
        collectedAssets
      ).join(', ')}`
    );
  }

  return { [requestedPlatform]: collectedAssets[collectedAssetsKey] };
}

/** Try to load the asset map for logging the names of assets published */
async function loadAssetMapAsync(distRoot: string): Promise<AssetMap | null> {
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
export async function collectAssetsAsync(dir: string): Promise<CollectedAssets> {
  const metadata = loadMetadata(dir);
  const assetmap = await loadAssetMapAsync(dir);

  const collectedAssets: CollectedAssets = {};

  for (const platform of Object.keys(metadata.fileMetadata) as ExpoConfigPlatform[]) {
    collectedAssets[platform] = {
      launchAsset: {
        // path.extname() returns an empty string when there's no extension so we use || to fall back to .bundle
        fileExtension: path.extname(metadata.fileMetadata[platform].bundle) || '.bundle',
        contentType: 'application/javascript',
        path: path.resolve(dir, metadata.fileMetadata[platform].bundle),
      },
      assets: metadata.fileMetadata[platform].assets.map(asset => ({
        fileExtension: asset.ext ? ensureLeadingPeriod(asset.ext) : undefined,
        originalPath: getOriginalPathFromAssetMap(assetmap, asset) ?? undefined,
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
  assetsForUpdateInfoGroup: FilteredCollectedAssets,
  projectId: string,
  cancelationToken: { isCanceledOrFinished: boolean },
  onAssetUploadResultsChanged: (
    assetUploadResults: { asset: RawAsset & { storageKey: string }; finished: boolean }[]
  ) => void,
  onAssetUploadBegin: () => void
): Promise<AssetUploadResult> {
  let assets: RawAsset[] = [];
  let platform: keyof FilteredCollectedAssets;
  const launchAssets: RawAsset[] = [];
  for (platform in assetsForUpdateInfoGroup) {
    launchAssets.push(assetsForUpdateInfoGroup[platform]!.launchAsset);
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

  onAssetUploadResultsChanged?.(uniqueAssets.map(asset => ({ asset, finished: false })));
  let missingAssets = await filterOutAssetsThatAlreadyExistAsync(graphqlClient, uniqueAssets);
  let missingAssetStorageKeys = new Set(missingAssets.map(a => a.storageKey));
  const uniqueUploadedAssetCount = missingAssets.length;
  const uniqueUploadedAssetPaths = missingAssets.map(asset => asset.originalPath).filter(truthy);

  if (cancelationToken.isCanceledOrFinished) {
    throw Error('Canceled upload');
  }

  const missingAssetChunks = chunk(missingAssets, 100);
  const specifications: string[] = [];
  for (const missingAssets of missingAssetChunks) {
    const { specifications: chunkSpecifications } = await PublishMutation.getUploadURLsAsync(
      graphqlClient,
      missingAssets.map(ma => ma.contentType)
    );
    specifications.push(...chunkSpecifications);
  }

  onAssetUploadResultsChanged?.(
    uniqueAssets.map(asset => ({ asset, finished: !missingAssetStorageKeys.has(asset.storageKey) }))
  );

  const assetUploadPromiseLimit = promiseLimit(15);

  const [assetLimitPerUpdateGroup] = await Promise.all([
    PublishQuery.getAssetLimitPerUpdateGroupAsync(graphqlClient, projectId),
    Promise.all(
      missingAssets.map((missingAsset, i) => {
        return assetUploadPromiseLimit(async () => {
          if (cancelationToken.isCanceledOrFinished) {
            throw Error('Canceled upload');
          }
          const presignedPost: PresignedPost = JSON.parse(specifications[i]);
          await uploadWithPresignedPostWithRetryAsync(
            missingAsset.path,
            presignedPost,
            onAssetUploadBegin
          );
        });
      })
    ),
  ]);

  let timeout = 1;
  while (missingAssets.length > 0) {
    if (cancelationToken.isCanceledOrFinished) {
      throw Error('Canceled upload');
    }

    const timeoutPromise = new Promise(resolve =>
      setTimeout(resolve, Math.min(timeout * 1000, 5000))
    ); // linear backoff
    missingAssets = await filterOutAssetsThatAlreadyExistAsync(graphqlClient, missingAssets);
    missingAssetStorageKeys = new Set(missingAssets.map(a => a.storageKey));
    await timeoutPromise; // await after filterOutAssetsThatAlreadyExistAsync for easy mocking with jest.runAllTimers
    timeout += 1;
    onAssetUploadResultsChanged?.(
      uniqueAssets.map(asset => ({
        asset,
        finished: !missingAssetStorageKeys.has(asset.storageKey),
      }))
    );
  }

  cancelationToken.isCanceledOrFinished = true;

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

export async function getBranchNameForCommandAsync({
  graphqlClient,
  projectId,
  channelNameArg,
  branchNameArg,
  autoFlag,
  nonInteractive,
  paginatedQueryOptions,
  vcsClient,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  channelNameArg: string | undefined;
  branchNameArg: string | undefined;
  autoFlag: boolean;
  nonInteractive: boolean;
  paginatedQueryOptions: PaginatedQueryOptions;
  vcsClient: Client;
}): Promise<string> {
  if (channelNameArg && branchNameArg) {
    throw new Error(
      'Cannot specify both --channel and --branch. Specify either --channel, --branch, or --auto.'
    );
  }

  if (channelNameArg) {
    const { branchName } = await getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
      graphqlClient,
      projectId,
      channelNameArg
    );
    return branchName;
  }

  if (branchNameArg) {
    return branchNameArg;
  }

  if (autoFlag) {
    const defaultBranchNameFromVcs = await getDefaultBranchNameAsync(vcsClient);
    if (!defaultBranchNameFromVcs) {
      throw new Error(
        'Must supply --branch or --channel for branch name as auto-detection of branch name via --auto is not supported when no VCS is present.'
      );
    }
    return defaultBranchNameFromVcs;
  } else if (nonInteractive) {
    throw new Error('Must supply --channel, --branch or --auto when in non-interactive mode.');
  } else {
    let branchName: string;

    try {
      const branch = await selectBranchOnAppAsync(graphqlClient, {
        projectId,
        promptTitle: `Which branch would you like to use?`,
        displayTextForListItem: updateBranch => ({
          title: `${updateBranch.name} ${chalk.grey(
            `- current update: ${formatUpdateMessage(updateBranch.updates[0])}`
          )}`,
        }),
        paginatedQueryOptions,
      });
      branchName = branch.name;
    } catch {
      // unable to select a branch (network error or no branches for project)
      const { name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'No branches found. Provide a branch name:',
        initial: (await getDefaultBranchNameAsync(vcsClient)) ?? undefined,
        validate: value => (value ? true : 'Branch name may not be empty.'),
      });
      branchName = name;
    }

    assert(branchName, 'Branch name must be specified.');
    return branchName;
  }
}

export async function getUpdateMessageForCommandAsync(
  vcsClient: Client,
  {
    updateMessageArg,
    autoFlag,
    nonInteractive,
    jsonFlag,
  }: {
    updateMessageArg: string | undefined;
    autoFlag: boolean;
    nonInteractive: boolean;
    jsonFlag: boolean;
  }
): Promise<string | undefined> {
  let updateMessage = updateMessageArg;
  if (!updateMessageArg && autoFlag) {
    updateMessage = (await vcsClient.getLastCommitMessageAsync())?.trim();
  }

  if (!updateMessage) {
    if (nonInteractive || jsonFlag) {
      if (vcsClient.canGetLastCommitMessage()) {
        throw new Error(
          'Must supply --message or use --auto when in non-interactive mode and VCS is available'
        );
      }
      return undefined;
    }

    const { updateMessageLocal } = await promptAsync({
      type: 'text',
      name: 'updateMessageLocal',
      message: `Provide an update message:`,
      initial: (await vcsClient.getLastCommitMessageAsync())?.trim(),
    });
    if (!updateMessageLocal) {
      return undefined;
    }

    updateMessage = updateMessageLocal;
  }

  if (!updateMessage) {
    return undefined;
  }

  const truncatedMessage = truncateUpdateMessage(updateMessage, 1024);
  if (truncatedMessage !== updateMessage) {
    Log.warn('Update message exceeds the allowed 1024 character limit. Truncating message...');
  }

  return truncatedMessage;
}

export const defaultPublishPlatforms: UpdatePublishPlatform[] = ['android', 'ios'];

export type RuntimeVersionInfo = {
  runtimeVersion: string;
  expoUpdatesRuntimeFingerprint: {
    fingerprintSources: object[];
    isDebugFingerprintSource: boolean;
  } | null;
  expoUpdatesRuntimeFingerprintHash: string | null;
};

type FingerprintInfoGroup = {
  [key in UpdatePublishPlatform]?: FingerprintInfo;
};

type FingerprintInfo = {
  fingerprintHash: string;
  fingerprintSource: FingerprintSource;
};

export async function getRuntimeVersionInfoObjectsAsync({
  exp,
  platforms,
  workflows,
  projectDir,
  env,
}: {
  exp: ExpoConfig;
  platforms: UpdatePublishPlatform[];
  workflows: Record<ExpoConfigPlatform, Workflow>;
  projectDir: string;
  env: Env | undefined;
}): Promise<
  {
    platform: UpdatePublishPlatform;
    runtimeVersionInfo: RuntimeVersionInfo;
  }[]
> {
  return await Promise.all(
    platforms.map(async platform => {
      return {
        platform,
        runtimeVersionInfo: await getRuntimeVersionInfoForPlatformAsync({
          exp,
          platform,
          workflow: workflows[platform],
          projectDir,
          env,
        }),
      };
    })
  );
}

async function getRuntimeVersionInfoForPlatformAsync({
  exp,
  platform,
  workflow,
  projectDir,
  env,
}: {
  exp: ExpoConfig;
  platform: UpdatePublishPlatform;
  workflow: Workflow;
  projectDir: string;
  env: Env | undefined;
}): Promise<{
  runtimeVersion: string;
  expoUpdatesRuntimeFingerprint: {
    fingerprintSources: object[];
    isDebugFingerprintSource: boolean;
  } | null;
  expoUpdatesRuntimeFingerprintHash: string | null;
}> {
  if (await isModernExpoUpdatesCLIWithRuntimeVersionCommandSupportedAsync(projectDir)) {
    try {
      const runtimeVersionResult = await resolveRuntimeVersionUsingCLIAsync({
        platform,
        workflow,
        projectDir,
        env,
      });

      return {
        ...runtimeVersionResult,
        runtimeVersion: nullthrows(
          runtimeVersionResult.runtimeVersion,
          `Unable to determine runtime version for ${
            requestedPlatformDisplayNames[platform]
          }. ${learnMore('https://docs.expo.dev/eas-update/runtime-versions/')}`
        ),
      };
    } catch (e: any) {
      // if it's a known set of errors thrown by the CLI it means that we need to default back to the
      // previous behavior, otherwise we throw the error since something is wrong
      if (!(e instanceof ExpoUpdatesCLIModuleNotFoundError)) {
        throw e;
      }
    }
  }

  const runtimeVersion = exp[platform]?.runtimeVersion ?? exp.runtimeVersion;
  if (typeof runtimeVersion === 'object') {
    if (workflow !== Workflow.MANAGED) {
      throw new Error(
        `You're currently using the bare workflow, where runtime version policies are not supported. You must set your runtime version manually. For example, define your runtime version as "1.0.0", not {"policy": "appVersion"} in your app config. ${learnMore(
          'https://docs.expo.dev/eas-update/runtime-versions'
        )}`
      );
    }
  }

  const resolvedRuntimeVersion = await Updates.getRuntimeVersionAsync(projectDir, exp, platform);
  if (!resolvedRuntimeVersion) {
    throw new Error(
      `Unable to determine runtime version for ${
        requestedPlatformDisplayNames[platform]
      }. ${learnMore('https://docs.expo.dev/eas-update/runtime-versions/')}`
    );
  }

  return {
    runtimeVersion: resolvedRuntimeVersion,
    expoUpdatesRuntimeFingerprint: null,
    expoUpdatesRuntimeFingerprintHash: null,
  };
}

export function getRuntimeToPlatformsAndFingerprintInfoMappingFromRuntimeVersionInfoObjects(
  runtimeVersionInfoObjects: {
    platform: UpdatePublishPlatform;
    runtimeVersionInfo: RuntimeVersionInfo;
  }[]
): (RuntimeVersionInfo & { platforms: UpdatePublishPlatform[] })[] {
  const groupedRuntimeVersionInfoObjects = groupBy(
    runtimeVersionInfoObjects,
    runtimeVersionInfoObject => runtimeVersionInfoObject.runtimeVersionInfo.runtimeVersion
  );

  return Object.entries(groupedRuntimeVersionInfoObjects).map(
    ([runtimeVersion, runtimeVersionInfoObjects]) => {
      return {
        runtimeVersion,
        platforms: runtimeVersionInfoObjects.map(
          runtimeVersionInfoObject => runtimeVersionInfoObject.platform
        ),
        expoUpdatesRuntimeFingerprint:
          runtimeVersionInfoObjects.map(
            runtimeVersionInfoObject =>
              runtimeVersionInfoObject.runtimeVersionInfo.expoUpdatesRuntimeFingerprint
          )[0] ?? null,
        expoUpdatesRuntimeFingerprintHash:
          runtimeVersionInfoObjects.map(
            runtimeVersionInfoObject =>
              runtimeVersionInfoObject.runtimeVersionInfo.expoUpdatesRuntimeFingerprintHash
          )[0] ?? null,
      };
    }
  );
}

export async function maybeCalculateFingerprintForRuntimeVersionInfoObjectsWithoutExpoUpdatesAsync({
  projectDir,
  graphqlClient,
  runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMapping,
  workflowsByPlatform,
  env,
}: {
  projectDir: string;
  graphqlClient: ExpoGraphqlClient;
  runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMapping: (RuntimeVersionInfo & {
    platforms: UpdatePublishPlatform[];
    expoUpdatesRuntimeFingerprintSource: FingerprintSource | null;
  })[];
  workflowsByPlatform: Record<Platform, Workflow>;
  env: Env | undefined;
}): Promise<
  (RuntimeVersionInfo & {
    platforms: UpdatePublishPlatform[];
    expoUpdatesRuntimeFingerprintSource: FingerprintSource | null;
    fingerprintInfoGroup: FingerprintInfoGroup;
  })[]
> {
  const runtimesToComputeFingerprintsFor =
    runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMapping.filter(
      infoGroup => !infoGroup.expoUpdatesRuntimeFingerprintHash
    );
  const fingerprintOptionsByRuntimeAndPlatform = new Map<string, FingerprintOptions>();
  for (const infoGroup of runtimesToComputeFingerprintsFor) {
    for (const platform of infoGroup.platforms) {
      const runtimeAndPlatform = `${infoGroup.runtimeVersion}-${platform}`;
      const options = {
        platforms: [platform],
        workflow: workflowsByPlatform[platform],
        projectDir,
        env,
      };
      fingerprintOptionsByRuntimeAndPlatform.set(runtimeAndPlatform, options);
    }
  }
  const fingerprintsByRuntimeAndPlatform = await createFingerprintsByKeyAsync(
    projectDir,
    fingerprintOptionsByRuntimeAndPlatform
  );
  const uploadedFingerprintsByRuntimeAndPlatform = await mapMapAsync(
    fingerprintsByRuntimeAndPlatform,
    async fingerprint => {
      return {
        ...fingerprint,
        uploadedSource: (
          await maybeUploadFingerprintAsync({
            hash: fingerprint.hash,
            fingerprint: {
              fingerprintSources: fingerprint.sources,
              isDebugFingerprintSource: fingerprint.isDebugSource,
            },
            graphqlClient,
          })
        ).fingerprintSource,
      };
    }
  );
  const runtimesWithComputedFingerprint = runtimesToComputeFingerprintsFor.map(runtimeInfo => {
    const fingerprintInfoGroup: FingerprintInfoGroup = {};
    for (const platform of runtimeInfo.platforms) {
      const runtimeAndPlatform = `${runtimeInfo.runtimeVersion}-${platform}`;
      const fingerprint = uploadedFingerprintsByRuntimeAndPlatform.get(runtimeAndPlatform);
      if (fingerprint && fingerprint.uploadedSource) {
        fingerprintInfoGroup[platform] = {
          fingerprintHash: fingerprint.hash,
          fingerprintSource: fingerprint.uploadedSource,
        };
      }
    }
    return {
      ...runtimeInfo,
      fingerprintInfoGroup,
    };
  });

  // These are runtimes whose fingerprint has already been computed and uploaded with EAS Update fingerprint runtime policy
  const runtimesWithPreviouslyComputedFingerprints =
    runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMapping
      .filter(
        (
          infoGroup
        ): infoGroup is RuntimeVersionInfo & {
          platforms: UpdatePublishPlatform[];
          expoUpdatesRuntimeFingerprintSource: FingerprintSource;
          expoUpdatesRuntimeFingerprintHash: string;
        } =>
          !!infoGroup.expoUpdatesRuntimeFingerprintHash &&
          !!infoGroup.expoUpdatesRuntimeFingerprintSource
      )
      .map(infoGroup => {
        const platform = infoGroup.platforms[0];
        return {
          ...infoGroup,
          fingerprintInfoGroup: {
            [platform]: {
              fingerprintHash: infoGroup.expoUpdatesRuntimeFingerprintHash,
              fingerprintSource: infoGroup.expoUpdatesRuntimeFingerprintSource,
            },
          },
        };
      });
  return [...runtimesWithComputedFingerprint, ...runtimesWithPreviouslyComputedFingerprints];
}

export async function findCompatibleBuildsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  runtimeToPlatformsAndFingerprintInfoMapping: {
    runtimeVersion: string;
    platforms: UpdatePublishPlatform[];
    fingerprintInfoGroup: FingerprintInfoGroup;
  }
): Promise<{
  runtimeVersion: string;
  platforms: UpdatePublishPlatform[];
  fingerprintInfoGroupWithCompatibleBuilds: {
    android?: (FingerprintInfo & { build?: BuildFragment }) | undefined;
    ios?: (FingerprintInfo & { build?: BuildFragment }) | undefined;
  };
}> {
  const { fingerprintInfoGroup } = runtimeToPlatformsAndFingerprintInfoMapping;
  const entriesPromises = Object.entries(fingerprintInfoGroup).map(
    async ([platform, fingerprintInfo]) => {
      const build = (
        await fetchBuildsAsync({
          graphqlClient,
          projectId: appId,
          filters: {
            fingerprintHash: fingerprintInfo.fingerprintHash,
          },
        })
      )[0] as BuildFragment | undefined;
      return [platform, { ...fingerprintInfo, build }];
    }
  );
  const entries = await Promise.all(entriesPromises);
  const fingerprintInfoGroupWithCompatibleBuilds = Object.fromEntries(entries) as {
    android?: (FingerprintInfo & { build?: BuildFragment }) | undefined;
    ios?: (FingerprintInfo & { build?: BuildFragment }) | undefined;
  };
  return {
    ...runtimeToPlatformsAndFingerprintInfoMapping,
    fingerprintInfoGroupWithCompatibleBuilds,
  };
}

export const platformDisplayNames: Record<UpdatePublishPlatform, string> = {
  android: 'Android',
  ios: 'iOS',
};

export const updatePublishPlatformToAppPlatform: Record<UpdatePublishPlatform, AppPlatform> = {
  android: AppPlatform.Android,
  ios: AppPlatform.Ios,
};

export async function getRuntimeToUpdateRolloutInfoGroupMappingAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    branchName,
    rolloutPercentage,
    runtimeToPlatformsAndFingerprintInfoMapping,
  }: {
    appId: string;
    branchName: string;
    rolloutPercentage: number;
    runtimeToPlatformsAndFingerprintInfoMapping: (RuntimeVersionInfo & {
      platforms: UpdatePublishPlatform[];
    })[];
  }
): Promise<Map<string, UpdateRolloutInfoGroup>> {
  const runtimeToPlatformsMap = new Map(
    runtimeToPlatformsAndFingerprintInfoMapping.map(r => [r.runtimeVersion, r.platforms])
  );
  return await mapMapAsync(runtimeToPlatformsMap, async (platforms, runtimeVersion) => {
    return await getUpdateRolloutInfoGroupAsync(graphqlClient, {
      appId,
      branchName,
      rolloutPercentage,
      runtimeVersion,
      platforms,
    });
  });
}

export async function getUpdateRolloutInfoGroupAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    branchName,
    rolloutPercentage,
    runtimeVersion,
    platforms,
  }: {
    appId: string;
    branchName: string;
    rolloutPercentage: number;
    runtimeVersion: string;
    platforms: UpdatePublishPlatform[];
  }
): Promise<UpdateRolloutInfoGroup> {
  // note that this could return control updates in different update groups if the update groups only have a single platform
  return Object.fromEntries(
    await Promise.all(
      platforms.map<Promise<[string, UpdateRolloutInfo]>>(async platform => {
        const updateIdForPlatform = await BranchQuery.getLatestUpdateIdOnBranchAsync(
          graphqlClient,
          {
            appId,
            branchName,
            runtimeVersion,
            platform: updatePublishPlatformToAppPlatform[platform],
          }
        );
        return [platform, { rolloutPercentage, rolloutControlUpdateId: updateIdForPlatform }];
      })
    )
  );
}
