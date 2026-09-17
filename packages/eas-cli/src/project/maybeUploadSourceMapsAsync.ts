import chalk from 'chalk';
import glob from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { loadMetadata } from './publish';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  SourceMapSourceInput,
  SourceMapSourceType,
  UPLOAD_SESSION_TYPE_EAS_UPDATE_SOURCE_MAPS,
} from '../graphql/sourceMapShim';
import Log from '../log';
import { uploadFileAtPathToGCSAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { getTmpDirectory } from '../utils/paths';
import { createProgressTracker } from '../utils/progress';

/** Platforms for which EAS stores a source map. The GraphQL SourceMapGroup input has no `web`. */
export const SOURCE_MAP_PLATFORMS = ['android', 'ios'] as const;
export type SourceMapPlatform = (typeof SOURCE_MAP_PLATFORMS)[number];

export type SourceMapSources = Partial<Record<SourceMapPlatform, SourceMapSourceInput>>;

/**
 * Maximum size the EAS upload session accepts for a source map. Mirrors `maxSizeBytes` for
 * `GCS_EAS_UPDATE_SOURCE_MAPS` in the server's upload configuration.
 */
export const MAX_SOURCE_MAP_SIZE_BYTES = 5 * 1024 * 1024;

export function isSourceMapPlatform(platform: string): platform is SourceMapPlatform {
  return SOURCE_MAP_PLATFORMS.includes(platform as SourceMapPlatform);
}

/**
 * Upload the source map that `expo export` emitted for each native platform.
 *
 * Publishing must never fail because of a source map, so every failure path warns and yields no
 * entry for that platform.
 */
export async function maybeUploadSourceMapsAsync(
  distRoot: string,
  graphqlClient: ExpoGraphqlClient
): Promise<SourceMapSources | null> {
  let sourceMapPathByPlatform: Partial<Record<SourceMapPlatform, string>>;
  try {
    sourceMapPathByPlatform = await resolveSourceMapPathsAsync(distRoot);
  } catch (err: any) {
    Log.warn(`Failed to locate source maps in ${distRoot}.\n\nReason: ${err.message}`);
    return null;
  }

  const sources: SourceMapSources = {};
  for (const platform of SOURCE_MAP_PLATFORMS) {
    const sourceMapPath = sourceMapPathByPlatform[platform];
    if (!sourceMapPath) {
      continue;
    }
    const source = await uploadSourceMapForPlatformAsync(graphqlClient, sourceMapPath, platform);
    if (source) {
      sources[platform] = source;
    }
  }

  return Object.keys(sources).length > 0 ? sources : null;
}

async function uploadSourceMapForPlatformAsync(
  graphqlClient: ExpoGraphqlClient,
  sourceMapPath: string,
  platform: SourceMapPlatform
): Promise<SourceMapSourceInput | null> {
  try {
    // Always strip, so application source text never reaches EAS storage and the map has a chance
    // of fitting under the upload limit.
    const strippedPath = await stripSourcesContentAsync(sourceMapPath, platform);
    const { size } = await fs.promises.stat(strippedPath);

    if (size > MAX_SOURCE_MAP_SIZE_BYTES) {
      Log.warn(
        `Skipping the ${platform} source map because it is ${formatBytes(
          size
        )}, above the ${formatBytes(MAX_SOURCE_MAP_SIZE_BYTES)} limit for source map uploads.`
      );
      return null;
    }

    const bucketKey = await uploadFileAtPathToGCSAsync(
      graphqlClient,
      UPLOAD_SESSION_TYPE_EAS_UPDATE_SOURCE_MAPS,
      strippedPath,
      createProgressTracker({
        total: size,
        message: ratio =>
          `Uploading ${platform} source map (${formatBytes(size * ratio)} / ${formatBytes(size)})`,
        completedMessage: (duration: string) =>
          `Uploaded ${platform} source map ${chalk.dim(duration)}`,
      })
    );

    return { type: SourceMapSourceType.Gcs, bucketKey };
  } catch (err: any) {
    let errMessage = `Failed to upload the ${platform} source map to EAS`;
    if (err.message) {
      errMessage += `\n\nReason: ${err.message}`;
    }
    Log.warn(errMessage);
    return null;
  }
}

/**
 * Find the source map for each native platform in the export directory.
 *
 * The maps are not listed in metadata.json, so they are located relative to the bundle that
 * metadata.json does name. That ties each map to the bundle actually being published.
 */
export async function resolveSourceMapPathsAsync(
  distRoot: string
): Promise<Partial<Record<SourceMapPlatform, string>>> {
  const metadata = loadMetadata(distRoot);
  const paths: Partial<Record<SourceMapPlatform, string>> = {};

  for (const platform of SOURCE_MAP_PLATFORMS) {
    const bundle = metadata.fileMetadata[platform]?.bundle;
    if (!bundle) {
      continue;
    }

    const bundlePath = path.resolve(distRoot, bundle);
    const sourceMapPath = `${bundlePath}.map`;
    if (await fs.pathExists(sourceMapPath)) {
      paths[platform] = sourceMapPath;
      continue;
    }

    // Older Expo CLI versions name the map after the bundle without its extension.
    const siblingMaps = await glob('*.map', { cwd: path.dirname(bundlePath), absolute: true });
    if (siblingMaps.length === 1) {
      paths[platform] = siblingMaps[0];
      continue;
    }

    if (siblingMaps.length > 1) {
      Log.warn(
        `Found ${siblingMaps.length} source maps next to the ${platform} bundle and cannot tell which one belongs to it. Skipping the ${platform} source map.`
      );
    } else {
      Log.warn(
        `No source map was found for the ${platform} bundle. Skipping the ${platform} source map.`
      );
    }
  }

  return paths;
}

/**
 * Write a copy of the source map with every `sourcesContent` removed.
 *
 * Symbolication needs `mappings`, `sources` and `names`; `sourcesContent` only supplies the source
 * text shown around a frame, and it is the bulk of a Hermes source map. The copy goes to a temporary
 * directory so the export directory is left untouched.
 */
export async function stripSourcesContentAsync(
  sourceMapPath: string,
  platform: SourceMapPlatform
): Promise<string> {
  const sourceMap = JSON.parse(await fs.readFile(sourceMapPath, 'utf8')) as unknown;
  if (!isRecord(sourceMap) || sourceMap.version !== 3) {
    throw new Error(`Invalid source map at ${sourceMapPath}. Expected a version 3 source map.`);
  }

  removeSourcesContent(sourceMap);

  const uploadDirectory = path.join(getTmpDirectory(), uuidv4());
  const uploadPath = path.join(uploadDirectory, `${platform}.map`);
  await fs.ensureDir(uploadDirectory);
  await fs.writeFile(uploadPath, JSON.stringify(sourceMap), 'utf8');
  return uploadPath;
}

function removeSourcesContent(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      removeSourcesContent(child);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  delete value.sourcesContent;
  for (const child of Object.values(value)) {
    removeSourcesContent(child);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
