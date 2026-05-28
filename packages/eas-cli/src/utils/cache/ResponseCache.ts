// Ported from @expo/cli.
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/api/rest/cache/ResponseCache.ts
//
// Adapted for eas-cli:
//   - Uses eas-cli's node-fetch types (`Response`, `RequestInfo`, `RequestInit`, `Headers`)
//     re-exported from `src/fetch.ts`. The upstream uses fetch-nodeshim, which exposes
//     web-standard `ReadableStream` bodies — here `ResponseCacheEntry.body` is a Node
//     `Readable` because node-fetch v2 returns Node streams.
//   - `getRequestInfoCacheData` only handles `string` and `URL` inputs. node-fetch's
//     `RequestInfo` is `string | Request` (no `URL`), and node-fetch's `Request` does
//     not expose all the web-standard fields (`credentials`, `destination`, `integrity`,
//     `redirect`, `referrer`, `referrerPolicy`) that upstream hashes; the Expo Go
//     download path only ever passes a string URL, so the simpler shape is sufficient.

import crypto from 'crypto';

import { RequestInfo, RequestInit, Response } from '../../fetch';

const GLOBAL_CACHE_VERSION = 4;

export type ResponseCacheEntry = {
  // Widened to `NodeJS.ReadableStream` (vs the upstream `ReadableStream`) so a
  // node-fetch `response.body` (typed `NodeJS.ReadableStream`) flows in directly,
  // while concrete `Readable`/`ReadStream` instances returned by the cache still
  // satisfy it.
  body: NodeJS.ReadableStream;
  info: ReturnType<typeof getResponseInfo>;
};

export interface ResponseCache {
  /** Load the response info from cache, if any */
  get(cacheKey: string): Promise<ResponseCacheEntry | undefined>;
  /** Store the response info to cache, and return the cached info */
  set(cacheKey: string, response: ResponseCacheEntry): Promise<ResponseCacheEntry | undefined>;
  /** Remove a response entry from the cache */
  remove(cacheKey: string): Promise<void>;
}

export function getResponseInfo(response: Response): {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
} {
  const headers = Object.fromEntries(response.headers.entries());
  delete headers['set-cookie'];
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    headers,
  };
}

export function getRequestCacheKey(info: RequestInfo, init?: RequestInit): string {
  const infoKeyData = getRequestInfoCacheData(info);
  const initKeyData = { body: init?.body ? getRequestBodyCacheData(init.body) : undefined };

  return crypto
    .createHash('md5')
    .update(JSON.stringify([infoKeyData, initKeyData, GLOBAL_CACHE_VERSION]))
    .digest('hex');
}

/** @internal Exposed for testing */
export function getRequestInfoCacheData(info: RequestInfo): { url: string } {
  if (typeof info === 'string') {
    return { url: info };
  }
  // node-fetch's `RequestInfo = string | URLLike | Request`. `URLLike` only has
  // `href`; `Request` has `url`. Discriminate by property — using `instanceof` would
  // miss the plain-object `URLLike` shape.
  if ('url' in info) {
    return { url: info.url.toString() };
  }
  // Upstream also hashes `credentials`, `destination`, `integrity`, `redirect`,
  // `referrer`, `referrerPolicy`, `headers`, and `method` for `Request` inputs; those
  // fields either don't exist on node-fetch's `Request` or aren't varied in eas-cli's
  // usage of this cache, so we keep the key minimal.
  return { url: info.href };
}

/** @internal Exposed for testing */
export function getRequestBodyCacheData(body: RequestInit['body']): unknown {
  if (!body) {
    return body;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Buffer) {
    return body.toString();
  }
  // Upstream also handles `fs.ReadStream` and `FormData`. eas-cli never sends those
  // through the cached fetch, so we omit the branches and surface unknown bodies
  // loudly rather than silently mis-keying them.
  throw new Error(`Unsupported request body type for caching: ${typeof body}`);
}
