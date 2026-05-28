// Ported from @expo/cli.
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/api/rest/cache/FileSystemResponseCache.ts
//
// Adapted for eas-cli:
//   - `ResponseCacheEntry.body` is a Node `Readable` instead of a web `ReadableStream`
//     (node-fetch v2 vs fetch-nodeshim). Reading the cache opens `fs.createReadStream`
//     directly instead of going through `Readable.toWeb`.
//   - Storing a response no longer needs `body.tee()` to peek for emptiness: with a
//     single-consumer Node `Readable` we just pipe the entire response straight to disk
//     and then check the resulting file size to set the `empty` marker. Functionally
//     identical, but works on node-fetch's stream type.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';

import type { ResponseCache, ResponseCacheEntry } from './ResponseCache';

const pipelineAsync = promisify(pipeline);

type FileSystemResponseCacheInfo = ResponseCacheEntry['info'] & {
  /** The path to the cached body file */
  bodyPath?: string;
  /** If there is no response body */
  empty?: boolean;
  /** The expiration time, in milliseconds, when the response should be invalidated */
  expiration?: number;
};

export class FileSystemResponseCache implements ResponseCache {
  /** The absolute path to the directory used to store responses */
  private cacheDirectory: string;
  /** Optional auto-expiration for all stored responses */
  private timeToLive?: number;

  constructor(options: { cacheDirectory: string; ttl?: number }) {
    this.cacheDirectory = options.cacheDirectory;
    this.timeToLive = options.ttl;
  }

  private getFilePaths(cacheKey: string): { info: string; body: string } {
    const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
    return {
      info: path.join(this.cacheDirectory, `${hash}-info.json`),
      body: path.join(this.cacheDirectory, `${hash}-body.bin`),
    };
  }

  async get(cacheKey: string): Promise<ResponseCacheEntry | undefined> {
    const paths = this.getFilePaths(cacheKey);

    try {
      await fs.promises.access(paths.info);
    } catch {
      return undefined;
    }

    try {
      const infoBuffer = await fs.promises.readFile(paths.info);
      const responseInfo: FileSystemResponseCacheInfo = JSON.parse(infoBuffer.toString());

      // Check if the response has expired
      if (responseInfo.expiration && responseInfo.expiration < Date.now()) {
        await this.remove(cacheKey);
        return undefined;
      }

      // Remove cache-specific data from the response info
      const { empty, expiration: _expiration, bodyPath: _bodyPath, ...cleanInfo } = responseInfo;

      // Create response body stream. Adapted: open a `fs.createReadStream` directly
      // instead of routing through `Readable.toWeb` since the consumer expects a Node
      // `Readable` (see `Adapted for eas-cli` in `ResponseCache.ts`).
      const body: Readable = empty
        ? Readable.from(Buffer.alloc(0))
        : fs.createReadStream(paths.body);

      return { body, info: cleanInfo };
    } catch {
      return undefined;
    }
  }

  async set(
    cacheKey: string,
    response: ResponseCacheEntry
  ): Promise<ResponseCacheEntry | undefined> {
    await fs.promises.mkdir(this.cacheDirectory, { recursive: true });
    const paths = this.getFilePaths(cacheKey);

    const responseInfo: FileSystemResponseCacheInfo = { ...response.info };
    if (typeof this.timeToLive === 'number') {
      responseInfo.expiration = Date.now() + this.timeToLive;
    }

    try {
      // Adapted: upstream tees a web `ReadableStream` into "peek for emptiness" + "write
      // to file" branches. node-fetch's `Readable` is single-consumer, so we pipe the
      // body straight to disk and then check the resulting file size to detect an empty
      // body. Net effect is the same.
      await pipelineAsync(response.body, fs.createWriteStream(paths.body));
      const stat = await fs.promises.stat(paths.body);
      if (stat.size === 0) {
        responseInfo.empty = true;
        await fs.promises.unlink(paths.body).catch(() => {});
      } else {
        responseInfo.bodyPath = paths.body;
      }

      await fs.promises.writeFile(paths.info, JSON.stringify(responseInfo));

      return await this.get(cacheKey);
    } catch (error) {
      // Clean up any partially written files
      await this.remove(cacheKey);
      throw error;
    }
  }

  async remove(cacheKey: string): Promise<void> {
    const paths = this.getFilePaths(cacheKey);
    await removeAllAsync(paths.info, paths.body);
  }
}

function removeAllAsync(...paths: string[]): Promise<unknown> {
  return Promise.all(
    paths.map(p => fs.promises.rm(p, { recursive: true, force: true }).catch(() => {}))
  );
}
