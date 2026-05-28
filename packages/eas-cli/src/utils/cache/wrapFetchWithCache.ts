// Ported from @expo/cli.
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/api/rest/cache/wrapFetchWithCache.ts
//
// Adapted for eas-cli:
//   - Constructs a node-fetch v2 `Response` (the eas-cli `src/fetch.ts` export) instead
//     of a fetch-nodeshim `Response`. The cached body is a Node `Readable` which
//     node-fetch accepts directly as a Response body. The cached `url` field is preserved
//     in `info` but not threaded into node-fetch's init (node-fetch v2's `ResponseInit`
//     only exposes `status`, `statusText`, and `headers`); for the eas-cli download flow
//     `response.url` isn't read after the fetch.
//   - eas-cli's default fetch throws on HTTP >= 400 (see `src/fetch.ts`), so the
//     `!response.ok` short-circuit upstream relies on is effectively superseded by the
//     thrown error. The guard is kept for symmetry with upstream and to remain correct
//     if a future caller passes a fetch that doesn't throw.

import { RequestInfo, RequestInit, Response } from '../../fetch';
import Log from '../../log';
import {
  getRequestCacheKey,
  getResponseInfo,
  type ResponseCache,
  type ResponseCacheEntry,
} from './ResponseCache';

export type FetchLike = (url: RequestInfo, init?: RequestInit) => Promise<Response>;

export function wrapFetchWithCache(fetch: FetchLike, cache: ResponseCache): FetchLike {
  return async function cachedFetch(url, init) {
    const cacheKey = getRequestCacheKey(url, init);
    const cachedResponse = await cache.get(cacheKey);
    if (cachedResponse) {
      return responseFromCacheEntry(cachedResponse);
    }

    await lock(cacheKey);

    try {
      // Retry loading from cache, in case it was stored while we were waiting for the lock.
      let entry = await cache.get(cacheKey);
      if (entry) {
        return responseFromCacheEntry(entry);
      }

      // Execute the fetch request
      const response = await fetch(url, init);
      if (!response.ok || !response.body) {
        return response;
      }

      // Cache the response
      entry = await cache.set(cacheKey, {
        body: response.body,
        info: getResponseInfo(response),
      });

      // Warn through debug logs that caching failed
      if (!entry) {
        Log.debug(`Failed to cache response for: ${url.toString()}`);
        await cache.remove(cacheKey);
        return response;
      }

      // Return the cached response
      return responseFromCacheEntry(entry);
    } finally {
      unlock(cacheKey);
    }
  };
}

function responseFromCacheEntry(entry: ResponseCacheEntry): Response {
  return new Response(entry.body, {
    status: entry.info.status,
    statusText: entry.info.statusText,
    headers: entry.info.headers,
  });
}

const lockPromiseForKey: Record<string, Promise<unknown>> = {};
const unlockFunctionForKey: Record<string, () => void> = {};

async function lock(key: string): Promise<unknown> {
  if (!lockPromiseForKey[key]) {
    lockPromiseForKey[key] = Promise.resolve();
  }

  const takeLockPromise = lockPromiseForKey[key];
  lockPromiseForKey[key] = takeLockPromise.then(
    () =>
      new Promise<void>(fulfill => {
        unlockFunctionForKey[key] = fulfill;
      })
  );

  return await takeLockPromise;
}

function unlock(key: string): void {
  if (unlockFunctionForKey[key]) {
    unlockFunctionForKey[key]();
    delete unlockFunctionForKey[key];
  }
}
