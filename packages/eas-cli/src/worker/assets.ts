import fs, { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createHash, randomBytes, HashOptions } from 'node:crypto';
import { Gzip, GzipOptions } from 'minizlib';
import { pack } from 'tar-stream';

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
async function* listAssetMapFiles(assetPath: string, assetMap: AssetMap): AsyncGenerator<WorkerFileEntry> {
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
type FileEntry = readonly [
  normalizedPath: string,
  data: Buffer | string,
];

/** Packs file entries into a tgz file (path to tgz returned) */
async function packFilesIterable(
  iterable: Iterable<FileEntry> | AsyncIterable<FileEntry>,
  options?: GzipOptions
): Promise<string> {
  const writePath = `${await createTempWritePath()}.tgz`;
  const write = createWriteStream(writePath);
  const gzip = new Gzip({ portable: true, ...options });
  const tar = pack();
  const _writeTask = pipeline(tar, gzip, write);
  for await (const file of iterable) {
    tar.entry({ name: file[0], type: 'file' }, file[1]);
  }
  tar.finalize();
  await _writeTask;
  return writePath;
}

export {
  createAssetMap,
  listWorkerFiles,
  listAssetMapFiles,
  packFilesIterable,
};
