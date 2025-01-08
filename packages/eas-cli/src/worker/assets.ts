import { parseProjectEnv } from '@expo/env';
import { Gzip, GzipOptions } from 'minizlib';
import { HashOptions, createHash, randomBytes } from 'node:crypto';
import fs, { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pack } from 'tar-stream';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvironmentVariableEnvironment } from '../graphql/generated';
import { EnvironmentVariablesQuery } from '../graphql/queries/EnvironmentVariablesQuery';

/** Returns whether a file or folder is ignored */
function isIgnoredName(name: string): boolean {
  switch (name) {
    // macOS system files
    case '.DS_Store':
    case '.AppleDouble':
    case '.Trashes':
    case '__MACOSX':
    case '.LSOverride':
      return true;
    default:
      // Backup file name convention
      return name.endsWith('~');
  }
}

/** Creates a temporary file write path */
async function createTempWritePathAsync(): Promise<string> {
  const basename = path.basename(__filename, path.extname(__filename));
  const tmpdir = await fs.promises.realpath(os.tmpdir());
  const random = randomBytes(4).toString('hex');
  return path.resolve(tmpdir, `tmp-${basename}-${process.pid}-${random}`);
}

/** Computes a SHA512 hash for a file */
async function computeSha512HashAsync(
  filePath: fs.PathLike,
  options?: HashOptions
): Promise<string> {
  const hash = createHash('sha512', { encoding: 'hex', ...options });
  await pipeline(fs.createReadStream(filePath), hash);
  return `${hash.read()}`;
}

/** A file entry with a gzip-safe (normalized) path and a filesystem path */
interface RecursiveFileEntry {
  normalizedPath: string;
  path: string;
}

/** Lists plain files in base path recursively and outputs normalized paths */
function listFilesRecursively(basePath: string): AsyncGenerator<RecursiveFileEntry> {
  async function* recurseAsync(parentPath?: string): AsyncGenerator<RecursiveFileEntry> {
    const target = parentPath ? path.resolve(basePath, parentPath) : basePath;
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    for (const dirent of entries) {
      const normalizedPath = parentPath ? `${parentPath}/${dirent.name}` : dirent.name;
      if (isIgnoredName(dirent.name)) {
        continue;
      } else if (dirent.isFile()) {
        yield {
          normalizedPath,
          path: path.resolve(target, dirent.name),
        };
      } else if (dirent.isDirectory()) {
        yield* recurseAsync(normalizedPath);
      }
    }
  }
  return recurseAsync();
}

interface AssetMapOptions {
  hashOptions?: HashOptions;
}

/** Mapping of normalized file paths to a SHA512 hash */
export type AssetMap = Record<string, string>;

/** Creates an asset map of a given target path */
async function createAssetMapAsync(
  assetPath?: string,
  options?: AssetMapOptions
): Promise<AssetMap> {
  const map: AssetMap = Object.create(null);
  if (assetPath) {
    for await (const file of listFilesRecursively(assetPath)) {
      map[file.normalizedPath] = await computeSha512HashAsync(file.path, options?.hashOptions);
    }
  }
  return map;
}

export interface Manifest {
  env: Record<string, string | undefined>;
}

export interface CreateManifestResult {
  conflictingVariableNames: string[] | undefined;
  manifest: Manifest;
}

interface CreateManifestParams {
  projectId: string;
  projectDir: string;
  environment?: EnvironmentVariableEnvironment;
}

/** Creates a manifest configuration sent up for deployment */
export async function createManifestAsync(
  params: CreateManifestParams,
  graphqlClient: ExpoGraphqlClient
): Promise<CreateManifestResult> {
  // Resolve .env file variables
  const { env } = parseProjectEnv(params.projectDir, { mode: 'production' });
  // Maybe load EAS Environment Variables (based on `--environment` arg)
  let conflictingVariableNames: string[] | undefined;
  if (params.environment) {
    const loadedVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(
      graphqlClient,
      {
        appId: params.projectId,
        environment: params.environment,
      }
    );
    // Load EAS Env vars into `env` object, keeping track of conflicts
    conflictingVariableNames = [];
    for (const variable of loadedVariables) {
      if (variable.value != null) {
        if (env[variable.name] != null) {
          conflictingVariableNames.push(variable.name);
        }
        env[variable.name] = variable.value;
      }
    }
  }
  const manifest: Manifest = { env };
  return { conflictingVariableNames, manifest };
}

interface WorkerFileEntry {
  normalizedPath: string;
  path: string;
  data: Buffer | string;
}

/** Reads worker files while normalizing sourcemaps and providing normalized paths */
async function* listWorkerFilesAsync(workerPath: string): AsyncGenerator<WorkerFileEntry> {
  for await (const file of listFilesRecursively(workerPath)) {
    yield {
      normalizedPath: file.normalizedPath,
      path: file.path,
      data: await fs.promises.readFile(file.path),
    };
  }
}

interface AssetFileEntry {
  normalizedPath: string;
  sha512: string;
  path: string;
}

/** Reads files of an asset maps and enumerates normalized paths and data */
async function* listAssetMapFilesAsync(
  assetPath: string,
  assetMap: AssetMap
): AsyncGenerator<AssetFileEntry> {
  for (const normalizedPath in assetMap) {
    const filePath = path.resolve(assetPath, normalizedPath.split('/').join(path.sep));
    yield {
      normalizedPath,
      path: filePath,
      sha512: assetMap[normalizedPath],
    };
  }
}

/** Entry of a normalized (gzip-safe) path and file data */
export type FileEntry = readonly [normalizedPath: string, data: Buffer | string];

/** Packs file entries into a tar.gz file (path to tgz returned) */
async function packFilesIterableAsync(
  iterable: Iterable<FileEntry> | AsyncIterable<FileEntry>,
  options?: GzipOptions
): Promise<string> {
  const writePath = `${await createTempWritePathAsync()}.tar.gz`;
  const write = createWriteStream(writePath);
  const gzip = new Gzip({ portable: true, ...options });
  const tar = pack();
  const writeTask$ = pipeline(tar, gzip, write);
  for await (const file of iterable) {
    tar.entry({ name: file[0], type: 'file' }, file[1]);
  }
  tar.finalize();
  await writeTask$;
  return writePath;
}

export {
  createAssetMapAsync,
  listWorkerFilesAsync,
  listAssetMapFilesAsync,
  packFilesIterableAsync,
};
