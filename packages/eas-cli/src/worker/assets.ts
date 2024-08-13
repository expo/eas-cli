/* eslint-disable async-protect/async-suffix */

import mime from 'mime';
import { Gzip, GzipOptions } from 'minizlib';
import { HashOptions, createHash, randomBytes } from 'node:crypto';
import fs, { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import promiseRetry from 'promise-retry';
import { pack } from 'tar-stream';

import fetch, { Headers, HeadersInit, RequestError, Response } from '../fetch';

// TODO(@kitten): Sending content with Content-Encoding: gzip is unreliable
// Disable compression for now
const R2_GZIP_COMPRESSION_ENABLED = false;

const MIN_COMPRESSION_SIZE = 5e4; // 50kB
const MAX_UPLOAD_SIZE = 5e8; // 5MB
const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable';

const isCompressible = (contentType: string | null, size: number): boolean => {
  if (size < MIN_COMPRESSION_SIZE) {
    // Don't compress small files
    return false;
  } else if (contentType && /^(?:audio|video|image)\//i.test(contentType)) {
    // Never compress images, audio, or videos as they're presumably precompressed
    return false;
  } else if (contentType && /^application\//i.test(contentType)) {
    // Only compress `application/` files if they're marked as XML/JSON/JS
    return /(?:xml|json5?|javascript)$/i.test(contentType);
  } else {
    return true;
  }
};

/** Creates a temporary file write path */
async function createTempWritePath(): Promise<string> {
  const basename = path.basename(__filename, path.extname(__filename));
  const tmpdir = await fs.promises.realpath(os.tmpdir());
  const random = randomBytes(4).toString('hex');
  return path.resolve(tmpdir, `tmp-${basename}-${process.pid}-${random}`);
}

/** Normalizes given sourcemap sources to relative paths for a given root path */
function formatSourcemap(rootPath: string, data: Buffer | string): Buffer | string {
  try {
    const cwd = process.cwd();
    const map = JSON.parse(data.toString('utf8'));
    let sources = map.sources || [];
    if (Array.isArray(sources)) {
      sources = sources.map(source => {
        return typeof source === 'string' && source.startsWith(cwd)
          ? path.relative(rootPath, source).split(path.sep).filter(Boolean).join('/')
          : source;
      });
    }
    return JSON.stringify({
      version: map.version,
      sources,
      sourcesContent:
        typeof map.sources.length === 'number' ? new Array(map.sources.length).fill(null) : null,
      names: map.names,
      mappings: map.mappings,
    });
  } catch {
    return data;
  }
}

/** Computes a SHA512 hash for a file */
async function computeSha512Hash(filePath: fs.PathLike, options?: HashOptions): Promise<string> {
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
  async function* recurse(parentPath?: string): AsyncGenerator<RecursiveFileEntry> {
    const target = parentPath ? path.resolve(basePath, parentPath) : basePath;
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    for (const dirent of entries) {
      const normalizedPath = parentPath ? `${parentPath}/${dirent.name}` : dirent.name;
      if (dirent.isFile()) {
        yield {
          normalizedPath,
          path: path.resolve(target, dirent.name),
        };
      } else if (dirent.isDirectory()) {
        yield* recurse(normalizedPath);
      }
    }
  }
  return recurse();
}

interface AssetMapOptions {
  hashOptions?: HashOptions;
}

/** Mapping of normalized file paths to a SHA512 hash */
export type AssetMap = Record<string, string>;

/** Creates an asset map of a given target path */
async function createAssetMap(assetPath: string, options?: AssetMapOptions): Promise<AssetMap> {
  const map: AssetMap = Object.create(null);
  for await (const file of listFilesRecursively(assetPath)) {
    map[file.normalizedPath] = await computeSha512Hash(file.path, options?.hashOptions);
  }
  return map;
}

interface WorkerFileEntry {
  normalizedPath: string;
  path: string;
  data: Buffer | string;
}

/** Reads worker files while normalizing sourcemaps and providing normalized paths */
async function* listWorkerFiles(workerPath: string): AsyncGenerator<WorkerFileEntry> {
  for await (const file of listFilesRecursively(workerPath)) {
    let data: string | Buffer = await fs.promises.readFile(file.path);
    if (path.extname(file.path) === '.map') {
      data = formatSourcemap(file.path, data);
    }
    yield {
      normalizedPath: file.normalizedPath,
      path: file.path,
      data,
    };
  }
}

/** Reads files of an asset maps and enumerates normalized paths and data */
async function* listAssetMapFiles(
  assetPath: string,
  assetMap: AssetMap
): AsyncGenerator<WorkerFileEntry> {
  for (const normalizedPath in assetMap) {
    const filePath = path.resolve(assetPath, normalizedPath.split('/').join(path.sep));
    const data = await fs.promises.readFile(filePath);
    yield {
      normalizedPath,
      path: filePath,
      data,
    };
  }
}

/** Entry of a normalized (gzip-safe) path and file data */
export type FileEntry = readonly [normalizedPath: string, data: Buffer | string];

/** Packs file entries into a tar.gz file (path to tgz returned) */
async function packFilesIterable(
  iterable: Iterable<FileEntry> | AsyncIterable<FileEntry>,
  options?: GzipOptions
): Promise<string> {
  const writePath = `${await createTempWritePath()}.tar.gz`;
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

interface UploadFileDataParams {
  url: string;
  filePath: string;
  shouldCompress?: boolean;
  headers?: HeadersInit;
}

async function uploadFileData(params: UploadFileDataParams): Promise<Response> {
  const stat = await fs.promises.stat(params.filePath);
  if (stat.size > MAX_UPLOAD_SIZE) {
    throw new Error(
      `Upload of "${params.filePath}" aborted: File size is greater than the upload limit (>500MB)`
    );
  }

  const contentType = mime.getType(path.basename(params.filePath));
  const shouldCompress = params.shouldCompress !== false && isCompressible(contentType, stat.size);

  return await promiseRetry(
    async retry => {
      const headers = new Headers(params.headers);
      // NOTE: We want to indicate that the particular uploads we're providing are immutable
      // However, this doesn't mean that the deployed worker should serve them with this header due to aliases
      headers.set('cache-control', CACHE_CONTROL_IMMUTABLE);
      headers.set('accept', 'application/json');
      if (contentType) {
        headers.set('content-type', contentType);
      }

      let bodyStream: NodeJS.ReadableStream = fs.createReadStream(params.filePath);
      if (shouldCompress && R2_GZIP_COMPRESSION_ENABLED) {
        const gzip = new Gzip({ portable: true });
        bodyStream.on('error', error => gzip.emit('error', error));
        // @ts-ignore: Gzip implements a Readable-like interface
        bodyStream = bodyStream.pipe(gzip) as NodeJS.ReadableStream;
        headers.set('content-encoding', 'gzip');
      }

      let response: Response;
      try {
        response = await fetch(params.url, {
          method: 'POST',
          body: bodyStream,
          headers,
        });
      } catch (error) {
        if (error instanceof RequestError) {
          response = error.response;
        } else {
          throw error;
        }
      }

      if (
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599)
      ) {
        const message = `Upload of "${params.filePath}" failed: ${response.statusText}`;
        const text = await response.text().catch(() => null);
        return retry(new Error(text ? `${message}\n${text}` : message));
      } else if (response.status === 413) {
        throw new Error(
          `Upload of "${params.filePath}" failed: File size exceeded the upload limit (>500MB)`
        );
      } else if (!response.ok) {
        throw new Error(`Upload of "${params.filePath}" failed: ${response.statusText}`);
      }

      return response;
    },
    {
      retries: 3,
      factor: 2,
    }
  );
}

export { createAssetMap, listWorkerFiles, listAssetMapFiles, packFilesIterable, uploadFileData };
