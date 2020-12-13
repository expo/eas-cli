import { Platform } from '@expo/config';
import crypto from 'crypto';
import fs from 'fs';
import { uniqBy } from 'lodash';
import { platform } from 'os';
import path from 'path';

import { PartialManifestAsset } from '../graphql/generated';
import { PublishMutation } from '../graphql/mutations/PublishMutation';
import { PublishQuery } from '../graphql/queries/PublishQuery';
import { PresignedPost, uploadWithPresignedPostAsync } from '../uploads';

export const TIMEOUT_LIMIT = 60_000; // 1 minute
let STORAGE_BUCKET: string;
export const Platforms: PublishPlatforms[] = ['android', 'ios']; // TODO-JJ allow users to specify this in app.js

if (process.env.NODE_ENV === 'test') {
  STORAGE_BUCKET = 'update-assets-testing';
} else if (process.env.EXPO_STAGING || process.env.EXPO_LOCAL) {
  STORAGE_BUCKET = 'update-assets-staging';
} else {
  STORAGE_BUCKET = 'update-assets-production';
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

export function guessContentTypeFromExtension(ext?: string): string {
  // copied from https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
  const CONTENT_TYPE: { [keyof: string]: string } = {
    aac: 'AACaudioaudio/aac',
    abw: 'application/x-abiword',
    arc: 'application/x-freearc',
    avi: 'video/x-msvideo',
    azw: 'application/vnd.amazon.ebook',
    bin: 'application/octet-stream',
    bmp: 'image/bmp',
    bz: 'application/x-bzip',
    bz2: 'application/x-bzip2',
    csh: 'Shellscriptapplication/x-csh',
    css: 'text/css',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    eot: 'application/vnd.ms-fontobject',
    epub: 'application/epub+zip',
    gz: 'application/gzip',
    gif: 'image/gif',
    htm: 'text/html',
    html: 'text/html',
    ico: 'image/vnd.microsoft.icon',
    ics: 'text/calendar',
    jar: 'application/java-archive',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    json: 'application/json',
    jsonld: 'application/ld+json',
    mid: 'audio/midi',
    midi: 'audio/midi',
    mjs: 'text/javascript',
    mp3: 'audio/mpeg',
    mpeg: 'video/mpeg',
    mpkg: 'application/vnd.apple.installer+xml',
    odp: 'application/vnd.oasis.opendocument.presentation',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odt: 'application/vnd.oasis.opendocument.text',
    oga: 'audio/ogg',
    ogv: 'video/ogg',
    ogx: 'application/ogg',
    opusaudio: 'audio/opus',
    otf: 'font/otf',
    png: 'image/png',
    pdf: 'application/pdf',
    php: 'application/x-httpd-php',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    rar: 'application/vnd.rar',
    rtf: 'application/rtf',
    sh: 'application/x-sh',
    svg: 'image/svg+xml',
    swf: 'application/x-shockwave-flash',
    tar: 'application/x-tar',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    ts: 'video/mp2t',
    ttf: 'font/ttf',
    txt: 'text/plain',
    vsd: 'application/vnd.visio',
    wav: 'audio/wav',
    weba: 'audio/webm',
    webm: 'video/webm',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    xhtml: 'application/xhtml+xml',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xml: 'application/xml',
    xul: 'application/vnd.mozilla.xul+xml',
    zip: 'application/zip',
    '7z': 'application/x-7z-compressed',
  };

  if (ext && ext in CONTENT_TYPE) {
    return CONTENT_TYPE[ext];
  }
  return 'application/octet-stream'; // unrecognized extension
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
  const contentType = asset['contentType'];
  return getStorageKey(contentType, fileHash);
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

export function buildUpdateInfoGroup(assets: CollectedAssets) {
  let platform: PublishPlatforms;
  const updateInfoGroup: any = {};
  for (platform in assets) {
    updateInfoGroup[platform] = {
      launchAsset: convertAssetToUpdateInfoGroupFormat(assets[platform]?.launchAsset!),
      assets: assets[platform]?.assets!.map(convertAssetToUpdateInfoGroupFormat),
    };
  }
  return updateInfoGroup;
}

export function getDistRoot(customDist: string): string {
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
    // load JSON with fs instead of require for easier mocking in tests
    return JSON.parse(fs.readFileSync(assetJsonPath).toString()).bundledAssets;
  }).flat();

  return [...new Set(assetPointers)].map(pointer => {
    const [filename, ext] = pointer.split('_').pop().split('.');
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
  const distRoot = getDistRoot(inputDir);
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
  const missingAssetMetadata = assetMetadata
    .filter((am: any) => am.status !== 'EXISTS')
    .map((am: any) => am.storageKey);

  const missingAssets = uniqueAssetsWithStorageKey.filter(asset => {
    return missingAssetMetadata.includes(asset.storageKey);
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
    missingAssets.map((ma: any) => ma.contentType)
  );

  await Promise.all(
    missingAssets.map((missingAsset, i) => {
      const presignedPost: PresignedPost = JSON.parse(specifications[i]);
      return uploadWithPresignedPostAsync(missingAsset.buffer, presignedPost);
    })
  );

  // Wait up to TIMEOUT_LIMIT for assets to be uploaded and processed
  const start = Date.now();
  while (missingAssets.length > 0) {
    if (process.env.NODE_ENV !== 'test') {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    missingAssets = await filterOutAssetsThatAlreadyExistAsync(missingAssets);

    if (Date.now() - start > TIMEOUT_LIMIT) {
      throw new Error('Failed to upload all assets. Please try again.');
    }
  }
}
